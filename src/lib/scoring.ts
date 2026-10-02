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
      // Any full stop that isn't a decimal point is leftover abbreviation punctuation ("rs." with
      // the unit word now gone, or a trailing "cm.") — drop it. A decimal point has a digit after
      // it and no letter before it, so ".5" (no leading zero) keeps its point.
      .replace(/\.(?!\d)|(?<=[a-z])\./g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * F129: a fill-in-the-blank answer is right if it matches the key after normalizeAnswer, or if it
 * is the right word with a small spelling slip -- a school student writing "photosynthsis" knows
 * the answer, and marking it wrong was misdiagnosing a spelling slip as a knowledge gap, which is
 * exactly the confusion this product exists to prevent.
 *
 * Deliberately conservative so a genuinely different word is not waved through:
 *  - anything containing a digit must match exactly (numbers are never "close enough"), except
 *    that the same number written another way is the same answer -- see sameNumber below;
 *  - spaces/hyphens are ignored ("photo-synthesis" = "photosynthesis");
 *  - the first letter must match (real misspellings almost never change it);
 *  - allowed edits scale with length: none up to 4 letters, 1 up to 8, 2 beyond, counting a
 *    swapped pair of adjacent letters as one edit. "meiosis" vs "mitosis" (2 edits, 7 letters)
 *    is still wrong.
 */
export function fillBlankMatches(response: string, expected: string): boolean {
  const given = normalizeAnswer(response)
  const key = normalizeAnswer(expected)
  if (given === key) return true
  if (sameNumber(given, key)) return true
  if (/\d/.test(given) || /\d/.test(key)) return false

  const compactGiven = given.replace(/[\s-]+/g, '')
  const compactKey = key.replace(/[\s-]+/g, '')
  if (compactGiven === compactKey) return true
  if (!compactGiven || compactGiven[0] !== compactKey[0]) return false

  const allowed = compactKey.length <= 4 ? 0 : compactKey.length <= 8 ? 1 : 2
  if (allowed === 0) return false
  if (Math.abs(compactGiven.length - compactKey.length) > allowed) return false
  return editDistance(compactGiven, compactKey) <= allowed
}

interface ParsedNumber {
  numerator: bigint
  denominator: bigint
  isFraction: boolean
}

// A plain number and nothing else: "12", "-0.5", ".2", "+3", "3/8", "1 / 2". Exact (BigInt), so
// 0.1 + 0.2 style float error can never make two different answers look equal.
function parseNumber(text: string): ParsedNumber | null {
  const t = text.replace(/−/g, '-').replace(/\s+/g, '')
  const fraction = /^([+-]?)(\d+)\/(\d+)$/.exec(t)
  if (fraction) {
    const denominator = BigInt(fraction[3])
    if (denominator === 0n) return null
    const numerator = BigInt(fraction[2]) * (fraction[1] === '-' ? -1n : 1n)
    return { numerator, denominator, isFraction: true }
  }
  const decimal = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(t)
  if (!decimal || (!decimal[2] && !decimal[3])) return null
  const places = decimal[3] || ''
  const numerator =
    BigInt((decimal[2] || '0') + places) * (decimal[1] === '-' ? -1n : 1n)
  return {
    numerator,
    denominator: 10n ** BigInt(places.length),
    isFraction: false,
  }
}

/**
 * The same number written another way: "0.5" for a key of "1/2", ".2" or "0.20" for "0.2", "+5"
 * for "5". Marking those wrong reads a formatting choice as a knowledge gap, the misdiagnosis
 * this product exists to prevent.
 *
 * One deliberate limit: two *fractions* still have to match as written, so "2/4" is not accepted
 * for a key of "1/2". Leaving a fraction unreduced is a delivery habit a marker would flag, not
 * a different way of writing the same final answer.
 */
function sameNumber(given: string, key: string): boolean {
  const a = parseNumber(given)
  const b = parseNumber(key)
  if (!a || !b) return false
  if (a.isFraction && b.isFraction) {
    return a.numerator === b.numerator && a.denominator === b.denominator
  }
  return a.numerator * b.denominator === b.numerator * a.denominator
}

// Optimal-string-alignment distance: insertions, deletions, substitutions and adjacent swaps.
function editDistance(a: string, b: string): number {
  const d: Array<Array<number>> = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (__, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
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
 *
 * F060's one exception: a question tagged is_reversal_word (NOT/least/false) is the one case
 * where the wrong-answer *cause* is knowable without shown work -- missing the reversal word is
 * a reading slip, not evidence the underlying concept is shaky, so it's classified as its own
 * 'Reading Discipline' category rather than folded into 'Conceptual Gap'.
 */
export function scoreObjectiveAnswer(params: {
  type: QuestionType
  marksMax: number
  correctOptionLabel?: string
  correctAnswerText: string
  selectedOption?: string | null
  responseText?: string | null
  isReversalWord?: boolean
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
      fillBlankMatches(params.responseText!, params.correctAnswerText)
  } else {
    isCorrect = Boolean(
      params.selectedOption &&
      params.correctOptionLabel &&
      params.selectedOption === params.correctOptionLabel,
    )
  }

  if (isCorrect) return { marksAwarded: params.marksMax, errorType: null }
  return {
    marksAwarded: 0,
    errorType: params.isReversalWord ? 'Reading Discipline' : 'Conceptual Gap',
  }
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
  // F060: "routed to a drill instead of re-teaching" — the concept name is deliberately absent
  // here, since the fix for a reading slip is not "revisit the concept" at all.
  'Reading Discipline': () =>
    `A word like NOT, least, or false in this question was missed — this needs a reading-discipline drill, not a concept re-teach.`,
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
