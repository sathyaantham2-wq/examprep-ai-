import type { Db } from '../db/connection'
import type {
  BloomLevel,
  DifficultyTier,
  QuestionType,
  ReviewTier,
} from '../db/enums'
import {
  questionsRepository,
  questionOptionsRepository,
  questionStepMarksRepository,
} from '../db/repositories'

// Objective, deterministic-answer types — everything else is subjective by nature.
const OBJECTIVE_TYPES = new Set<QuestionType>([
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'fill_blank',
])

/**
 * F117: tier is always derived from the question's own shape, never a discretionary admin
 * choice — "never mark a question Tier A to avoid review" (examprep-question-generation skill).
 * Tier A: objective, <=2 marks, English, no diagram. Everything else is Tier B.
 */
export function computeReviewTier(input: {
  marks: number
  type: QuestionType
  language: string
  diagram_kind?: string | null
}): ReviewTier {
  if (input.marks >= 3) return 'B'
  if (input.language !== 'English') return 'B'
  if (input.diagram_kind) return 'B'
  if (!OBJECTIVE_TYPES.has(input.type)) return 'B'
  return 'A'
}

export interface CreateQuestionInput {
  concept_id: string
  board: string
  class: number
  bloom: BloomLevel
  difficulty: DifficultyTier
  marks: number
  type: QuestionType
  text: string
  answer: string
  hint?: string
  tags?: Array<string>
  diagram_kind?: string
  diagram_params?: unknown
  language?: string
  created_by: string
  source_ref?: string
  options?: Array<{
    label: string
    text: string
    is_correct: boolean
    order_index: number
  }>
  step_marks?: Array<{ step_no: number; description: string; marks: number }>
}

/**
 * Writes a question plus its options and step marks as one transaction (F020/F021) and assigns
 * its review tier (F117). Tier A auto-approves immediately; Tier B stays draft pending
 * POST /api/questions/:id/approve.
 */
export async function createQuestion(db: Db, input: CreateQuestionInput) {
  const language = input.language ?? 'English'
  const reviewTier = computeReviewTier({
    marks: input.marks,
    type: input.type,
    language,
    diagram_kind: input.diagram_kind,
  })
  const status = reviewTier === 'A' ? 'approved' : 'draft'

  return db.transaction().execute(async (trx) => {
    const question = await questionsRepository.insert(trx, {
      concept_id: input.concept_id,
      board: input.board,
      class: input.class,
      bloom: input.bloom,
      difficulty: input.difficulty,
      marks: input.marks,
      type: input.type,
      text: input.text,
      answer: input.answer,
      hint: input.hint,
      tags: input.tags,
      diagram_kind: input.diagram_kind,
      diagram_params: input.diagram_params
        ? JSON.stringify(input.diagram_params)
        : undefined,
      language,
      status,
      created_by: input.created_by,
      source_ref: input.source_ref,
      review_tier: reviewTier,
    })

    const options = input.options
      ? await Promise.all(
          input.options.map((option) =>
            questionOptionsRepository.insert(trx, {
              question_id: question.id,
              ...option,
            }),
          ),
        )
      : []

    const stepMarks = input.step_marks
      ? await Promise.all(
          input.step_marks.map((step) =>
            questionStepMarksRepository.insert(trx, {
              question_id: question.id,
              ...step,
            }),
          ),
        )
      : []

    return { ...question, options, step_marks: stepMarks }
  })
}
