import type { Db } from '../db/connection'
import { completeText, isAiConfigured } from './ai-provider'
import { enforceAiCallBudget, logAiJob } from './ai-metering'
import { ModelCallError, callWithModelFallback, modelForFeature } from './ai-models'

// F126 / tab07 AI-13: "per-question worked explanation". Same shape as AI-09's generator
// (src/lib/ai-remediation.ts) -- resolved model tier, budget check, fallback, job logging.
const MODEL = modelForFeature('AI-13')

export function isAiExplanationConfigured(): boolean {
  return isAiConfigured()
}

export interface ExplanationInput {
  questionText: string
  /** MCQ only: every option as shown to her, so the explanation can name the right one. */
  options: Array<{ label: string; text: string }>
  correctAnswer: string
  conceptName: string
  classNumber: number
  /** Her own answer, when she got it wrong -- lets the explanation address the actual slip. */
  studentAnswer: string | null
  householdId: string
  studentId: string
}

/**
 * Writes a short worked explanation of why the correct answer is correct. Returns null when no AI
 * provider is configured, which the caller surfaces as "not available yet" rather than inventing
 * content -- the same graceful degradation AI-05/AI-09 use.
 *
 * This runs only AFTER her marks are confirmed (enforced by the route, not here): CLAUDE.md's
 * "never build a chat tutor that solves the problem" is about a live attempt, and the T09
 * amendment of 2026-09-22 is what allows showing the correct answer -- and therefore an
 * explanation of it -- once the paper is over.
 */
export async function generateQuestionExplanation(
  db: Db,
  input: ExplanationInput,
): Promise<string | null> {
  if (!isAiConfigured()) return null
  await enforceAiCallBudget(db, {
    feature: 'AI-13',
    model: MODEL,
    householdId: input.householdId,
    studentId: input.studentId,
  })

  const optionLines = input.options
    .map((o) => `${o.label}. ${o.text}`)
    .join('\n')

  const prompt = `A Class ${input.classNumber} CBSE student has just finished a practice paper and is reviewing it. Explain why the correct answer to this question is correct, so she understands the method and can do the next one herself.

Concept: ${input.conceptName}
Question: ${input.questionText}
${optionLines ? `Options:\n${optionLines}\n` : ''}Correct answer: ${input.correctAnswer}
${input.studentAnswer ? `She answered: ${input.studentAnswer}\n` : ''}
Rules:
- Work through it in 2-4 short numbered steps, in the order she would actually do them.
- Plain language for her age. No jargon she has not met at this class level.
- ${input.studentAnswer ? 'Name the likely slip in her answer in one short sentence at the end, kindly and without blame.' : 'End with the one idea worth remembering for next time.'}
- Never address her by name, never praise or scold, never mention marks.

Respond with ONLY a JSON object, no other text, matching exactly:
{"explanation": "the full explanation, using \\n between steps"}`

  const startedAt = Date.now()
  let response: Awaited<ReturnType<typeof completeText>>
  let modelUsed = MODEL
  try {
    const outcome = await callWithModelFallback(MODEL, (model) =>
      completeText({ model, prompt, maxTokens: 700 }),
    )
    response = outcome.result
    modelUsed = outcome.modelUsed
  } catch (err) {
    // 2026-09-24: log whichever model actually threw (the retry, if the primary already failed
    // and got swallowed by callWithModelFallback) rather than always the primary MODEL constant --
    // this is what caught Gemini's 2.5 retirement showing up in ai_jobs under the wrong model name.
    await logAiJob(db, {
      feature: 'AI-13',
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
    feature: 'AI-13',
    model: modelUsed,
    householdId: input.householdId,
    studentId: input.studentId,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    latencyMs: Date.now() - startedAt,
    status: 'success',
  })

  if (!response.text) return null
  try {
    const parsed = JSON.parse(response.text) as { explanation?: unknown }
    return typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : null
  } catch {
    return null
  }
}
