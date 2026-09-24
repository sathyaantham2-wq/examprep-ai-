import type { Db } from '../db/connection'
import type { ErrorType } from '../db/enums'
import { completeText, isAiConfigured } from './ai-provider'
import { enforceAiCallBudget, logAiJob } from './ai-metering'
import { ModelCallError, callWithModelFallback, modelForFeature } from './ai-models'

const ERROR_TYPES = [
  'Conceptual Gap',
  'Calculation Error',
  'Presentation Issue',
  'Formula/Definition Error',
  'Incomplete',
  'Not Attempted',
] as const

// F094: "strong model for generation and grading" -- resolved from tab07's task-to-model map
// (src/lib/ai-models.ts), not a hardcoded literal, so this stays in sync if that mapping changes.
const MODEL = modelForFeature('AI-05')

// Marks proposed with less confidence than this are never used: the answer goes to a person. This
// is what stops an uncertain AI grade from being confirmed automatically on adaptive papers.
export const MIN_GRADING_CONFIDENCE = 0.7

export function isAiGradingConfigured(): boolean {
  return isAiConfigured()
}

export interface SubjectiveGradingInput {
  questionText: string
  expectedAnswer: string
  marksMax: number
  stepMarks: Array<{ step_no: number; description: string; marks: number }>
  studentResponse: string
  conceptContext?: string
  // F091: always known here -- unlike AI-01, every grading call happens inside one household's
  // evaluation of one student's attempt.
  householdId: string
  studentId: string
}

export interface SubjectiveGradingResult {
  stepMarksAwarded: Array<{
    step_no: number
    marks_awarded: number
    justification: string
  }>
  totalMarks: number
  errorType: ErrorType | null
  feedback: string
  confidence: number
  needsManualMarking: boolean
}

const NEEDS_MANUAL_MARKING: SubjectiveGradingResult = {
  stepMarksAwarded: [],
  totalMarks: 0,
  errorType: null,
  feedback: 'Needs manual marking.',
  confidence: 0,
  needsManualMarking: true,
}

/**
 * AI-05 (tab07): proposes marks per step with justification against the stored marking scheme.
 * Never final — the caller writes this to evaluation_items.ai_marks/ai_error_type, never directly
 * to marks_awarded/error_type, so a human must confirm before it counts (CLAUDE.md hard rule).
 * Returns null if no AI key (Anthropic or Gemini) is configured — the caller falls back to "needs
 * manual marking" (this module's documented fallback per tab07), not a guess. An API failure or a
 * low-confidence grade also falls back to manual marking.
 */
export async function gradeSubjectiveAnswer(
  db: Db,
  input: SubjectiveGradingInput,
): Promise<SubjectiveGradingResult | null> {
  if (!isAiConfigured()) return null
  await enforceAiCallBudget(db, {
    feature: 'AI-05',
    model: MODEL,
    householdId: input.householdId,
    studentId: input.studentId,
  })

  const prompt = `You are grading one student's exam answer against a marking scheme. Be GENEROUS: this is practice for a school student, so give the benefit of the doubt. Award full marks for any correct method or valid alternative reasoning even if it differs from the expected answer, give partial marks for every step that is partly right, and do not deduct for spelling, grammar, neatness, or missing units unless the question is specifically about them. Do not award marks for something the response does not show at all. If the response is blank or genuinely illegible/unparseable, set "unreadable": true instead of guessing marks.

Question: ${input.questionText}
Expected answer: ${input.expectedAnswer}
Total marks available: ${input.marksMax}
Marking scheme:
${input.stepMarks.map((s) => `  Step ${s.step_no} (${s.marks} mark${s.marks === 1 ? '' : 's'}): ${s.description}`).join('\n')}
${input.conceptContext ? `Concept context: ${input.conceptContext}\n` : ''}
Student's response:
"""
${input.studentResponse}
"""

Respond with ONLY a JSON object, no other text, matching exactly:
{
  "unreadable": boolean,
  "steps": [{"step_no": number, "marks_awarded": number, "justification": "short reason citing the marking scheme step"}],
  "error_type": one of ${JSON.stringify(ERROR_TYPES)}, or null if full marks were awarded,
  "feedback": "one actionable sentence, max 25 words, naming the concept and the specific fix — no praise, no scolding",
  "confidence": number from 0 to 1
}`

  const startedAt = Date.now()
  let response: Awaited<ReturnType<typeof completeText>>
  let modelUsed = MODEL
  try {
    // F094: "automatic fallback on failure" -- a primary-model error (rate limit, outage, ...)
    // gets one retry against the cheap-tier model before this call gives up entirely.
    const outcome = await callWithModelFallback(MODEL, (model) =>
      completeText({ model, prompt, maxTokens: 1024 }),
    )
    response = outcome.result
    modelUsed = outcome.modelUsed
  } catch (err) {
    // 2026-09-24: log whichever model actually threw (see ai-models.ts's ModelCallError), not
    // always this constant -- a retry failure was otherwise misattributed to the primary model.
    await logAiJob(db, {
      feature: 'AI-05',
      model: err instanceof ModelCallError ? err.failedModel : MODEL,
      householdId: input.householdId,
      studentId: input.studentId,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
    // A vendor outage or rate limit must not break marking: the answer simply goes to a person.
    return NEEDS_MANUAL_MARKING
  }
  await logAiJob(db, {
    feature: 'AI-05',
    model: modelUsed,
    householdId: input.householdId,
    studentId: input.studentId,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    latencyMs: Date.now() - startedAt,
    status: 'success',
  })

  if (!response.text) return NEEDS_MANUAL_MARKING

  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    return NEEDS_MANUAL_MARKING
  }

  const result = parsed as {
    unreadable?: boolean
    steps?: Array<{
      step_no: number
      marks_awarded: number
      justification: string
    }>
    error_type?: ErrorType | null
    feedback?: string
    confidence?: number
  }

  if (result.unreadable) return NEEDS_MANUAL_MARKING

  const confidence = typeof result.confidence === 'number' ? result.confidence : 0
  if (confidence < MIN_GRADING_CONFIDENCE) return NEEDS_MANUAL_MARKING

  const normalised = normaliseSteps(result.steps ?? [], input.stepMarks, input.marksMax)
  if (!normalised) return NEEDS_MANUAL_MARKING
  const { steps, totalMarks } = normalised

  return {
    stepMarksAwarded: steps,
    totalMarks,
    errorType: result.error_type ?? null,
    feedback: result.feedback ?? '',
    confidence,
    needsManualMarking: false,
  }
}

interface RawStep {
  step_no: number
  marks_awarded: number
  justification: string
}

/**
 * Never trust the model's arithmetic: each step is capped at what the scheme allows for it, none
 * is negative, and the total is capped at the question's marks. Null when it gave no usable step.
 */
export function normaliseSteps(
  raw: Array<RawStep>,
  scheme: Array<{ step_no: number; marks: number }>,
  marksMax: number,
): { steps: Array<RawStep>; totalMarks: number } | null {
  const schemeMarks = new Map(scheme.map((s) => [s.step_no, s.marks]))
  const steps = raw
    .filter((s) => Number.isFinite(s.marks_awarded))
    .map((s) => ({
      ...s,
      marks_awarded: Math.min(Math.max(s.marks_awarded, 0), schemeMarks.get(s.step_no) ?? marksMax),
    }))
  if (steps.length === 0) return null
  return {
    steps,
    totalMarks: Math.min(
      steps.reduce((sum, step) => sum + step.marks_awarded, 0),
      marksMax,
    ),
  }
}

export interface DisputeReviewInput {
  questionText: string
  expectedAnswer: string
  marksMax: number
  stepMarks: Array<{ step_no: number; description: string; marks: number }>
  studentResponse: string
  previousMarks: number
  previousFeedback: string
  studentComment: string
  householdId: string
  studentId: string
}

export interface DisputeReviewResult {
  stepMarksAwarded: Array<RawStep>
  totalMarks: number
  reply: string
  changed: boolean
}

/**
 * The student disagrees with a mark and says why. The AI looks again, fairly and generously, and
 * answers in a few words. It may raise the mark or keep it, never lower it (asking must not cost
 * anything), and it must not reveal the correct answer or solve the problem. Returns null when no
 * AI is configured; throws when the vendor call fails or the reply is unusable, so the caller can
 * ask the student to retry without using up her one re-review.
 */
export async function reviewDisputedAnswer(
  db: Db,
  input: DisputeReviewInput,
): Promise<DisputeReviewResult | null> {
  if (!isAiConfigured()) return null
  await enforceAiCallBudget(db, {
    feature: 'AI-05',
    model: MODEL,
    householdId: input.householdId,
    studentId: input.studentId,
  })

  const scheme = input.stepMarks
    .map((s) => `  Step ${s.step_no} (${s.marks} mark${s.marks === 1 ? '' : 's'}): ${s.description}`)
    .join('\n')
  const prompt = `A school student disagrees with the mark you gave for one exam answer. Re-read the answer with the student's point in mind and mark it again. Be GENEROUS and fair: if the student is right, or their answer is reasonable, raise the mark; if the mark was already right, keep it and explain kindly. You may only keep or raise the mark, never lower it. NEVER reveal the correct answer, a model solution or the marking scheme: say only what the answer showed and what was missing, in general words.

Question: ${input.questionText}
Expected answer (private, do not reveal): ${input.expectedAnswer}
Total marks available: ${input.marksMax}
Marking scheme (private):
${scheme}

Student's answer:
"""
${input.studentResponse}
"""

Your earlier mark: ${input.previousMarks} out of ${input.marksMax}. Your earlier feedback: ${input.previousFeedback}
The student says:
"""
${input.studentComment}
"""

Respond with ONLY a JSON object, no other text, matching exactly:
{
  "steps": [{"step_no": number, "marks_awarded": number, "justification": "short reason"}],
  "reply": "2 or 3 friendly sentences to the student, max 60 words, saying whether the mark changed and why, without giving the answer"
}`

  const startedAt = Date.now()
  let response: Awaited<ReturnType<typeof completeText>>
  let modelUsed = MODEL
  try {
    const outcome = await callWithModelFallback(MODEL, (model) =>
      completeText({ model, prompt, maxTokens: 1024 }),
    )
    response = outcome.result
    modelUsed = outcome.modelUsed
  } catch (err) {
    // 2026-09-24: log whichever model actually threw (see ai-models.ts's ModelCallError), not
    // always this constant -- a retry failure was otherwise misattributed to the primary model.
    await logAiJob(db, {
      feature: 'AI-05',
      model: err instanceof ModelCallError ? err.failedModel : MODEL,
      householdId: input.householdId,
      studentId: input.studentId,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  await logAiJob(db, {
    feature: 'AI-05',
    model: modelUsed,
    householdId: input.householdId,
    studentId: input.studentId,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    latencyMs: Date.now() - startedAt,
    status: 'success',
  })

  let parsed: { steps?: Array<RawStep>; reply?: string } | null = null
  try {
    parsed = response.text ? (JSON.parse(response.text) as { steps?: Array<RawStep>; reply?: string }) : null
  } catch {
    parsed = null
  }
  const normalised = parsed ? normaliseSteps(parsed.steps ?? [], input.stepMarks, input.marksMax) : null
  const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim().slice(0, 600) : ''
  if (!normalised || reply === '') {
    throw new Error('The re-review could not be read')
  }
  const raised = normalised.totalMarks > input.previousMarks
  return {
    stepMarksAwarded: raised ? normalised.steps : [],
    totalMarks: raised ? normalised.totalMarks : input.previousMarks,
    reply,
    changed: raised,
  }
}
