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
import { AiCapReachedError, StudentSpendCapReachedError, enforceStudentSpendBudget } from './ai-metering'
import { recordMasteryAttempt } from './mastery'
import { recordPointsForConfirmedItems } from './points'
import type { GradedObjectiveItem } from './points'
import { recordConfirmedAnswers } from './adaptive/service'
import { captureError, describeError } from './error-log'
import { randomUUID } from 'node:crypto'

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

  const [allSlots, answers, student] = await Promise.all([
    paperQuestionsRepository.listForPaperWithQuestions(db, attempt.paper_id),
    attemptAnswersRepository.listForAttempt(db, attemptId),
    db
      .selectFrom('students')
      .select('household_id')
      .where('id', '=', attempt.student_id)
      .executeTakeFirstOrThrow(),
  ])
  const answerBySlot = new Map(answers.map((a) => [a.paper_question_id, a]))

  // F030: "handled correctly in evaluation." An OR pair (two slots sharing a choice_group) is
  // scored as ONE item, not two -- whichever member the student actually answered, or the
  // primary (first-inserted) member if neither was, so a printed-but-unattempted alternative
  // never shows up as an extra blank question dragging the percentage down.
  const hasAnswer = (slotId: string) => {
    const a = answerBySlot.get(slotId)
    return Boolean(
      a && ((a.selected_option?.length ?? 0) > 0 || (a.response_text?.trim().length ?? 0) > 0),
    )
  }
  const groups = new Map<string, typeof allSlots>()
  const slots: typeof allSlots = []
  for (const slot of allSlots) {
    if (!slot.choice_group) {
      slots.push(slot)
      continue
    }
    const group = groups.get(slot.choice_group)
    if (group) {
      group.push(slot)
    } else {
      groups.set(slot.choice_group, [slot])
    }
  }
  for (const group of groups.values()) {
    const chosen = group.find((s) => hasAnswer(s.id)) ?? group[0]
    slots.push(chosen)
  }
  slots.sort((a, b) => a.position - b.position)

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

  type EvaluationItemDraft = (typeof items)[number]
  const buildItem = async (slot: (typeof slots)[number]): Promise<EvaluationItemDraft> => {
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
        isReversalWord: slot.is_reversal_word,
      })
      anyAutoScored = true
      return {
        paper_question_id: slot.id,
        marks_awarded: marksAwarded,
        marks_max: slot.marks,
        ai_marks: null,
        error_type: errorType,
        ai_error_type: null,
        feedback: templateFeedback(errorType, conceptName),
      }
    }

    const stepMarks = await questionStepMarksRepository.listByQuestion(
      db,
      slot.question_id,
    )
    // F092/F121: a household call-count cap, or this student's own daily/monthly spend cap,
    // both degrade to the exact same "needs manual marking" path as ANTHROPIC_API_KEY not being
    // configured -- all three are "AI unavailable right now", and this path already has a
    // graceful, human-reviewable outcome rather than a failed request.
    let aiResult: Awaited<ReturnType<typeof gradeSubjectiveAnswer>> = null
    try {
      await enforceStudentSpendBudget(db, { studentId: attempt.student_id })
      aiResult = await gradeSubjectiveAnswer(db, {
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
        householdId: student.household_id,
        studentId: attempt.student_id,
      })
    } catch (err) {
      if (!(err instanceof AiCapReachedError) && !(err instanceof StudentSpendCapReachedError)) {
        throw err
      }
    }

    if (aiResult && !aiResult.needsManualMarking) {
      anyAutoScored = true
      return {
        paper_question_id: slot.id,
        marks_awarded: aiResult.totalMarks,
        marks_max: slot.marks,
        ai_marks: aiResult.totalMarks,
        error_type: aiResult.errorType,
        ai_error_type: aiResult.errorType,
        feedback: aiResult.feedback,
      }
    }
    return {
      paper_question_id: slot.id,
      marks_awarded: 0,
      marks_max: slot.marks,
      ai_marks: null,
      error_type: null,
      ai_error_type: null,
      feedback: 'Needs manual marking.',
    }
  }

  // Written answers each wait on the AI, so a few are marked at a time to keep a paper quick
  // without flooding the vendor's rate limit. Order is kept.
  const drafts: Array<EvaluationItemDraft> = new Array<EvaluationItemDraft>(slots.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(3, slots.length) }, async () => {
      while (next < slots.length) {
        const index = next++
        drafts[index] = await buildItem(slots[index])
      }
    }),
  )
  items.push(...drafts)

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
  const confirmed = await db.transaction().execute(async (trx) => {
    const evaluation = await evaluationsRepository.findById(trx, evaluationId)
    if (!evaluation) throw new Error('Evaluation not found')
    if (evaluation.confirmed_at)
      throw new Error('This evaluation is already confirmed')

    let items = await evaluationItemsRepository.listForEvaluation(
      trx,
      evaluationId,
    )
    const attempt = await trx
      .selectFrom('attempts')
      .selectAll()
      .where('id', '=', evaluation.attempt_id)
      .executeTakeFirstOrThrow()

    // A question the student removed after questioning its mark is left out of her grade, the
    // paper total and her concept results; the row itself is kept.
    const removed = items.filter((item) => item.excluded_by_student)
    items = items.filter((item) => !item.excluded_by_student)

    const actualScore = items.reduce(
      (sum, item) => sum + Number(item.marks_awarded),
      0,
    )
    const totalMarks =
      removed.length > 0
        ? items.reduce((sum, item) => sum + Number(item.marks_max), 0)
        : Number(evaluation.total_marks)
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
        total_marks: totalMarks,
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
    const gradedObjectiveItems: Array<GradedObjectiveItem> = []
    for (const item of items) {
      const slot = await trx
        .selectFrom('paper_questions')
        .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
        .select(['questions.concept_id', 'questions.type', 'questions.difficulty'])
        .where('paper_questions.id', '=', item.paper_question_id)
        .executeTakeFirstOrThrow()

      const existing = byConcept.get(slot.concept_id) ?? {
        marks: 0,
        marksMax: 0,
      }
      existing.marks += Number(item.marks_awarded)
      existing.marksMax += Number(item.marks_max)
      byConcept.set(slot.concept_id, existing)

      gradedObjectiveItems.push({
        evaluationItemId: item.id,
        conceptId: slot.concept_id,
        questionType: slot.type,
        difficulty: slot.difficulty,
        marksAwarded: Number(item.marks_awarded),
        marksMax: Number(item.marks_max),
      })
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

    // F125 (first slice): points/coins for MCQ-family items whose (now-confirmed) mark is fully
    // correct. removed/excluded items never reached gradedObjectiveItems (filtered out above),
    // so a question the student disputed away never pays out.
    await recordPointsForConfirmedItems(trx, attempt.student_id, gradedObjectiveItems)

    return updatedEvaluation
  })

  // Concept-level adaptive layer, built from the same confirmed marks. It is derived data that can
  // always be rebuilt from the evaluation (backfillStudent), so it runs after the confirmation has
  // committed and a failure is recorded instead of undoing a parent's confirmed marks.
  try {
    await recordConfirmedAnswers(db, evaluationId)
  } catch (error) {
    const { message, stack } = describeError(error)
    await captureError({
      requestId: randomUUID(),
      source: 'server',
      route: 'evaluation-confirm:adaptive-mastery',
      message,
      stack,
    })
  }

  return confirmed
}
