import type { Db } from '../db/connection'
import type { ErrorType } from '../db/enums'
import {
  attemptAnswersRepository,
  paperQuestionsRepository,
  questionOptionsRepository,
  questionStepMarksRepository,
  evaluationsRepository,
  evaluationItemsRepository,
} from '../db/repositories'
import {
  isObjectiveType,
  scoreObjectiveAnswer,
  templateFeedback,
} from './scoring'
import { gradeSubjectiveAnswer } from './ai-grading'
import { recordMasteryAttempt } from './mastery'

// A generic placeholder band, not a school- or board-specific grading scale — none is defined
// anywhere in the plan. Swap this out once a real one is decided.
function gradeFromPercentage(percentage: number): string {
  if (percentage >= 90) return 'A'
  if (percentage >= 75) return 'B'
  if (percentage >= 60) return 'C'
  if (percentage >= 40) return 'D'
  return 'E'
}

/**
 * F044-F046, F049: scores every question in a submitted attempt — objective questions
 * deterministically (F044/AI-04, never AI), subjective questions via AI-05 when configured. Marks
 * are pre-filled with the best available proposal so review is fast (F045's whole point), but
 * nothing here is final: marks_awarded is a proposal until POST /api/evaluations/:id/confirm.
 */
export async function createEvaluation(db: Db, attemptId: string) {
  const attempt = await db
    .selectFrom('attempts')
    .selectAll()
    .where('id', '=', attemptId)
    .executeTakeFirst()
  if (!attempt) throw new Error('Attempt not found')
  if (attempt.status !== 'submitted') {
    throw new Error('Attempt must be submitted before it can be evaluated')
  }

  const [slots, answers] = await Promise.all([
    paperQuestionsRepository.listForPaperWithQuestions(db, attempt.paper_id),
    attemptAnswersRepository.listForAttempt(db, attemptId),
  ])
  const answerBySlot = new Map(answers.map((a) => [a.paper_question_id, a]))

  let anyAutoScored = false
  const items: Array<{
    paper_question_id: string
    marks_awarded: number
    marks_max: number
    ai_marks: number | null
    error_type: ErrorType | null
    ai_error_type: ErrorType | null
    feedback: string
  }> = []

  for (const slot of slots) {
    const answer = answerBySlot.get(slot.id)
    const concept = await db
      .selectFrom('concepts')
      .select(['name', 'idea'])
      .where('id', '=', slot.concept_id)
      .executeTakeFirst()
    const conceptName = concept?.name ?? 'this concept'

    if (isObjectiveType(slot.type)) {
      const options = await questionOptionsRepository.listByQuestion(
        db,
        slot.question_id,
      )
      const correctOption = options.find((o) => o.is_correct)
      const { marksAwarded, errorType } = scoreObjectiveAnswer({
        type: slot.type,
        marksMax: slot.marks,
        correctOptionLabel: correctOption?.label,
        correctAnswerText: slot.answer,
        selectedOption: answer?.selected_option,
        responseText: answer?.response_text,
      })
      anyAutoScored = true
      items.push({
        paper_question_id: slot.id,
        marks_awarded: marksAwarded,
        marks_max: slot.marks,
        ai_marks: null,
        error_type: errorType,
        ai_error_type: null,
        feedback: templateFeedback(errorType, conceptName),
      })
      continue
    }

    const stepMarks = await questionStepMarksRepository.listByQuestion(
      db,
      slot.question_id,
    )
    const aiResult = await gradeSubjectiveAnswer({
      questionText: slot.text,
      expectedAnswer: slot.answer,
      marksMax: slot.marks,
      stepMarks: stepMarks.map((s) => ({
        step_no: s.step_no,
        description: s.description,
        marks: s.marks,
      })),
      studentResponse: answer?.response_text ?? '',
      conceptContext: concept?.idea ?? undefined,
    })

    if (aiResult && !aiResult.needsManualMarking) {
      anyAutoScored = true
      items.push({
        paper_question_id: slot.id,
        marks_awarded: aiResult.totalMarks,
        marks_max: slot.marks,
        ai_marks: aiResult.totalMarks,
        error_type: aiResult.errorType,
        ai_error_type: aiResult.errorType,
        feedback: aiResult.feedback,
      })
    } else {
      items.push({
        paper_question_id: slot.id,
        marks_awarded: 0,
        marks_max: slot.marks,
        ai_marks: null,
        error_type: null,
        ai_error_type: null,
        feedback: 'Needs manual marking.',
      })
    }
  }

  const totalMarks = slots.reduce((sum, slot) => sum + slot.marks, 0)

  return db.transaction().execute(async (trx) => {
    const evaluation = await evaluationsRepository.insert(trx, {
      attempt_id: attemptId,
      total_marks: totalMarks,
      // 'ai' covers both deterministic auto-scoring and real AI grading — neither is a human
      // yet, which is what this field is actually tracking pre-confirmation. Becomes 'mixed' at
      // confirm time if anything was overridden (F047), stays 'human' only when nothing at all
      // could be auto-scored (e.g. AI unconfigured and every question was subjective).
      evaluated_by: anyAutoScored ? 'ai' : 'human',
    })

    const created = await evaluationItemsRepository.insertMany(
      trx,
      items.map((item) => ({ ...item, evaluation_id: evaluation.id })),
    )

    return { evaluation, items: created }
  })
}

/**
 * F047/F061 payoff: finalises the marks a human has reviewed and writes each concept's result to
 * the mastery ledger. Questions on the same concept within one paper are aggregated into a single
 * ledger entry — the ledger models one row per (student, concept, sitting), not per question.
 */
export async function confirmEvaluation(db: Db, evaluationId: string) {
  return db.transaction().execute(async (trx) => {
    const evaluation = await evaluationsRepository.findById(trx, evaluationId)
    if (!evaluation) throw new Error('Evaluation not found')
    if (evaluation.confirmed_at)
      throw new Error('This evaluation is already confirmed')

    const items = await evaluationItemsRepository.listForEvaluation(
      trx,
      evaluationId,
    )
    const attempt = await trx
      .selectFrom('attempts')
      .selectAll()
      .where('id', '=', evaluation.attempt_id)
      .executeTakeFirstOrThrow()

    const actualScore = items.reduce(
      (sum, item) => sum + Number(item.marks_awarded),
      0,
    )
    const totalMarks = Number(evaluation.total_marks)
    const wasOverridden = items.some((item) => item.overridden_by != null)

    // F055/F056: Knowledge Score credits back marks lost to a delivery habit (the reviewer
    // marked knowledge_known=true on a lost-mark item) but not marks lost to a real gap
    // (knowledge_known=false, or never reviewed). Delivery Gap is the headline metric this
    // product is built around — it's meaningless until a human has actually made that call per
    // item, which is exactly what F047's override endpoint captures.
    const knowledgeCredit = items.reduce((sum, item) => {
      const lost = Number(item.marks_max) - Number(item.marks_awarded)
      return item.knowledge_known === true && lost > 0 ? sum + lost : sum
    }, 0)
    const knowledgeScore = actualScore + knowledgeCredit
    const deliveryGap = knowledgeScore - actualScore
    const percentage =
      totalMarks > 0 ? Math.round((actualScore / totalMarks) * 1000) / 10 : 0

    const updatedEvaluation = await evaluationsRepository.update(
      trx,
      evaluationId,
      {
        confirmed_at: new Date(),
        actual_score: actualScore,
        knowledge_score: knowledgeScore,
        delivery_gap: deliveryGap,
        percentage,
        // No school-specific grading scale is defined anywhere in the plan — this is a generic
        // placeholder band, not a CBSE-authoritative scale, easy to swap for a real one later.
        grade: gradeFromPercentage(percentage),
        evaluated_by: wasOverridden ? 'mixed' : evaluation.evaluated_by,
      },
    )

    await trx
      .updateTable('attempts')
      .set({ status: 'evaluated' })
      .where('id', '=', attempt.id)
      .execute()

    const byConcept = new Map<string, { marks: number; marksMax: number }>()
    for (const item of items) {
      const slot = await trx
        .selectFrom('paper_questions')
        .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
        .select(['questions.concept_id'])
        .where('paper_questions.id', '=', item.paper_question_id)
        .executeTakeFirstOrThrow()

      const existing = byConcept.get(slot.concept_id) ?? {
        marks: 0,
        marksMax: 0,
      }
      existing.marks += Number(item.marks_awarded)
      existing.marksMax += Number(item.marks_max)
      byConcept.set(slot.concept_id, existing)
    }

    const today = new Date().toISOString().slice(0, 10)
    for (const [conceptId, totals] of byConcept) {
      await recordMasteryAttempt(trx, {
        student_id: attempt.student_id,
        concept_id: conceptId,
        evaluation_id: evaluationId,
        date: today,
        marks: totals.marks,
        marks_max: totals.marksMax,
      })
    }

    return updatedEvaluation
  })
}
