import { z } from 'zod'
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
import { computeTextHash, findExactDuplicate } from './duplicate-detection'

const BLOOM_LEVELS = [
  'Remember',
  'Understand',
  'Apply',
  'Analyse',
  'Evaluate',
  'Create',
] as const
const DIFFICULTY_TIERS = ['Easy', 'Hard', 'Hardest'] as const
const QUESTION_TYPES = [
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'short_answer',
  'long_answer',
  'fill_blank',
  'diagram',
] as const

const optionSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
  is_correct: z.boolean(),
  order_index: z.number().int(),
})

const stepMarkSchema = z.object({
  step_no: z.number().int().positive(),
  description: z.string().min(1),
  marks: z.number().int().positive(),
})

/**
 * F020/F021's validation, shared by both a single POST /api/questions and each row of
 * F022's bulk import -- one question is never valid by different rules depending on which route
 * it arrived through.
 */
export const questionInputSchema = z
  .object({
    concept_id: z.string().uuid(),
    board: z.string().min(1),
    class: z.number().int().min(1).max(12),
    bloom: z.enum(BLOOM_LEVELS),
    difficulty: z.enum(DIFFICULTY_TIERS),
    marks: z.number().int().positive(),
    type: z.enum(QUESTION_TYPES),
    text: z.string().min(1),
    answer: z.string().min(1),
    hint: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    diagram_kind: z.string().min(1).optional(),
    diagram_params: z.unknown().optional(),
    language: z.string().min(1).optional(),
    source_ref: z.string().min(1).optional(),
    options: z.array(optionSchema).optional(),
    step_marks: z.array(stepMarkSchema).optional(),
    // F060: reversal-word questions (NOT/least/false) get a distinct 'Reading Discipline' error
    // classification on a wrong answer, instead of the usual 'Conceptual Gap' default.
    is_reversal_word: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'mcq') {
      const correctCount = (data.options ?? []).filter(
        (o) => o.is_correct,
      ).length
      if (correctCount !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'An mcq question must have exactly one correct option',
        })
      }
    }
    if (data.step_marks && data.step_marks.length > 0) {
      const sum = data.step_marks.reduce((total, step) => total + step.marks, 0)
      if (sum !== data.marks) {
        ctx.addIssue({
          code: 'custom',
          path: ['step_marks'],
          message: `Step marks sum to ${sum} but the question is worth ${data.marks}`,
        })
      }
    }
  })

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
  is_reversal_word?: boolean
  // F025: AI-authored questions always land in the review queue as Draft, even when their shape
  // would otherwise qualify for Tier A auto-approve -- Tier A exists to reduce review load on a
  // trusted human's routine entries, not to wave through unreviewed AI output.
  origin?: 'manual' | 'ai_generated'
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
 * POST /api/questions/:id/approve. F023: flags an exact-hash duplicate within the same concept
 * rather than blocking the save -- "warns with a link to the existing question", not a hard stop.
 */
export async function createQuestion(db: Db, input: CreateQuestionInput) {
  const language = input.language ?? 'English'
  const origin = input.origin ?? 'manual'
  const reviewTier = computeReviewTier({
    marks: input.marks,
    type: input.type,
    language,
    diagram_kind: input.diagram_kind,
  })
  const status =
    origin === 'ai_generated' ? 'draft' : reviewTier === 'A' ? 'approved' : 'draft'
  const textHash = computeTextHash(input.text)

  const duplicate = await findExactDuplicate(db, input.concept_id, textHash)

  const created = await db.transaction().execute(async (trx) => {
    const question = await questionsRepository.insert(trx, {
      concept_id: input.concept_id,
      board: input.board,
      class: input.class,
      bloom: input.bloom,
      difficulty: input.difficulty,
      marks: input.marks,
      type: input.type,
      text: input.text,
      text_hash: textHash,
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
      is_reversal_word: input.is_reversal_word ?? false,
      origin,
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

  return {
    ...created,
    duplicate_of: duplicate ? { id: duplicate.id, text: duplicate.text } : null,
  }
}
