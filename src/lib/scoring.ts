import type { ErrorType, QuestionType } from '../db/enums'

// Objective, deterministic-answer types (mirrors src/lib/questions.ts's OBJECTIVE_TYPES) — these
// are scored by comparison, never by AI.
const OBJECTIVE_TYPES = new Set<QuestionType>([
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'fill_blank',
])

export function isObjectiveType(type: QuestionType): boolean {
  return OBJECTIVE_TYPES.has(type)
}

/**
 * F044: case-insensitive, whitespace-collapsed, comma-stripped (handles Indian "1,00,000" vs
 * international "100,000" grouping identically), with common unit/currency symbols and trailing
 * full stops removed so "5 cm", "5cm", and "5 cm." all normalize the same.
 */
export function normalizeAnswer(raw: string): string {
  return (
    raw
      .toLowerCase()
      .trim()
      .replace(/,/g, '')
      .replace(/[₹%°]/g, '')
      // A unit glued straight onto a number ("5cm") has no word boundary between the digit and
      // the letter for \b to match on, so split them apart before stripping unit words below.
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/\b(rs\.?|rupees?|cm|mm|km|kg|gm?|litres?|ml)\b/g, '')
      // Any full stop that isn't a decimal point (digit on both sides) is leftover abbreviation
      // punctuation ("rs." with the unit word now gone, or a trailing "cm.") — drop it.
      .replace(/(?<!\d)\.|\.(?!\d)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export interface ObjectiveScoreResult {
  marksAwarded: number
  errorType: ErrorType | null
}

/**
 * F044/F046 for objective types only. An objective question graded wrong tells you it was wrong,
 * not *why* — real differentiation between Conceptual Gap / Calculation Error / Formula error
 * needs either shown work (subjective questions, F045's job) or a human's judgment, so a wrong
 * objective answer defaults to 'Conceptual Gap' rather than guessing more specifically.
 */
export function scoreObjectiveAnswer(params: {
  type: QuestionType
  marksMax: number
  correctOptionLabel?: string
  correctAnswerText: string
  selectedOption?: string | null
  responseText?: string | null
}): ObjectiveScoreResult {
  const attempted =
    Boolean(params.selectedOption) || Boolean(params.responseText?.trim())
  if (!attempted) {
    return { marksAwarded: 0, errorType: 'Not Attempted' }
  }

  let isCorrect: boolean
  if (params.type === 'fill_blank') {
    isCorrect =
      Boolean(params.responseText) &&
      normalizeAnswer(params.responseText!) ===
        normalizeAnswer(params.correctAnswerText)
  } else {
    isCorrect = Boolean(
      params.selectedOption &&
      params.correctOptionLabel &&
      params.selectedOption === params.correctOptionLabel,
    )
  }

  return isCorrect
    ? { marksAwarded: params.marksMax, errorType: null }
    : { marksAwarded: 0, errorType: 'Conceptual Gap' }
}

const TEMPLATE_FEEDBACK: Record<ErrorType, (conceptName: string) => string> = {
  'Not Attempted': (c) =>
    `This question on ${c} was left blank — attempt every question, even a partial answer earns partial credit.`,
  'Conceptual Gap': (c) =>
    `Revisit ${c} — the answer suggests the underlying idea isn't solid yet.`,
  'Calculation Error': (c) =>
    `The approach to ${c} was right, but a calculation slipped — double-check arithmetic before moving on.`,
  'Presentation Issue': (c) =>
    `The working for ${c} needs to be shown more clearly — marks are lost when steps aren't visible.`,
  'Formula/Definition Error': (c) =>
    `Check the formula/definition used for ${c} — it doesn't match what this question needs.`,
  Incomplete: (c) =>
    `The answer on ${c} stopped short — finish every step through to a final answer with units.`,
}

/**
 * F049's documented fallback (tab07 AI-08: "Template feedback from error type") — used for every
 * objective-question error (which is never AI-graded, per AI-04) and whenever subjective AI
 * grading isn't configured or fails.
 */
export function templateFeedback(
  errorType: ErrorType | null,
  conceptName: string,
): string {
  if (!errorType) return ''
  return TEMPLATE_FEEDBACK[errorType](conceptName)
}
