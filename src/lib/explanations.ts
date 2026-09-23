import type { Db } from '../db/connection'
import { generateQuestionExplanation } from './ai-explanation'

export interface StoredExplanation {
  explanation: string
  source: string
}

/** Cached explanations for a set of questions. Never generates -- read path only. */
export async function getCachedExplanations(
  db: Db,
  questionIds: Array<string>,
): Promise<Map<string, StoredExplanation>> {
  if (questionIds.length === 0) return new Map()
  const rows = await db
    .selectFrom('question_explanations')
    .select(['question_id', 'explanation', 'source'])
    .where('question_id', 'in', questionIds)
    .execute()
  return new Map(
    rows.map((r) => [
      r.question_id,
      { explanation: r.explanation, source: r.source },
    ]),
  )
}

/**
 * The free path: ~3,900 written questions already carry a step-by-step marking scheme
 * (question_step_marks, one row per step with its own description and marks). That reads as a
 * worked solution already, so it is used verbatim rather than paying an AI call to rewrite what
 * a human author has written. MCQs have none of these, which is exactly why AI-13 exists.
 */
async function explanationFromStepMarks(
  db: Db,
  questionId: string,
): Promise<string | null> {
  const steps = await db
    .selectFrom('question_step_marks')
    .select(['step_no', 'description'])
    .where('question_id', '=', questionId)
    .orderBy('step_no')
    .execute()
  if (steps.length === 0) return null
  return steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')
}

/**
 * F126: the explanation for one question, generating and caching it on first request.
 *
 * Caller must have already established that this student may see it (her own attempt, marks
 * confirmed) -- this function deliberately takes no attempt and performs no authorisation, so it
 * cannot be mistaken for the gate.
 *
 * Returns null when there is nothing to show and nothing can be generated (no AI configured, or
 * the model returned no usable text). The caller surfaces that as "not available", never as an
 * error and never as invented content.
 */
export async function getOrCreateExplanation(
  db: Db,
  input: {
    questionId: string
    householdId: string
    studentId: string
    studentAnswer: string | null
  },
): Promise<StoredExplanation | null> {
  const cached = await getCachedExplanations(db, [input.questionId])
  const hit = cached.get(input.questionId)
  if (hit) return hit

  const question = await db
    .selectFrom('questions as q')
    .innerJoin('concepts as c', 'c.id', 'q.concept_id')
    .select([
      'q.id',
      'q.text',
      'q.answer',
      'q.type',
      'q.class',
      'c.name as concept_name',
    ])
    .where('q.id', '=', input.questionId)
    .executeTakeFirst()
  if (!question) return null

  const fromSteps = await explanationFromStepMarks(db, input.questionId)
  if (fromSteps) {
    return persist(db, input.questionId, fromSteps, 'step_marks', null)
  }

  const options = await db
    .selectFrom('question_options')
    .select(['label', 'text', 'is_correct'])
    .where('question_id', '=', input.questionId)
    .orderBy('order_index')
    .execute()
  const correctOption = options.find((o) => o.is_correct)
  const correctAnswer =
    question.type === 'mcq' && correctOption
      ? `${correctOption.label}. ${correctOption.text}`
      : question.answer

  const generated = await generateQuestionExplanation(db, {
    questionText: question.text,
    // is_correct is deliberately dropped here: the model is told which answer is correct
    // separately, and the option list it sees is the same one the student saw.
    options: options.map((o) => ({ label: o.label, text: o.text })),
    correctAnswer,
    conceptName: question.concept_name,
    classNumber: question.class,
    studentAnswer: input.studentAnswer,
    householdId: input.householdId,
    studentId: input.studentId,
  })
  if (!generated) return null

  return persist(db, input.questionId, generated, 'ai', null)
}

async function persist(
  db: Db,
  questionId: string,
  explanation: string,
  source: string,
  model: string | null,
): Promise<StoredExplanation> {
  // One row per question (primary key), so a race between two students reviewing the same
  // question at once resolves to a single row rather than a duplicate-key error.
  await db
    .insertInto('question_explanations')
    .values({ question_id: questionId, explanation, source, model })
    .onConflict((oc) =>
      oc.column('question_id').doUpdateSet({
        explanation,
        source,
        model,
        updated_at: new Date(),
      }),
    )
    .execute()
  return { explanation, source }
}
