import type { Db } from '../db/connection'
import type { AiJobStatus } from '../db/enums'
import { aiJobsRepository } from '../db/repositories'

// Claude Sonnet 5 published rate: $2.00 / 1M input tokens, $10.00 / 1M output tokens. INR
// conversion uses a fixed approximate rate (documented assumption, not a live FX lookup) since
// there's no billing/FX infrastructure in this app yet.
const USD_PER_1M_INPUT = 2.0
const USD_PER_1M_OUTPUT = 10.0
const USD_TO_INR = 83

export function estimateCostInr(usage: {
  inputTokens: number
  outputTokens: number
}): number {
  const usd =
    (usage.inputTokens / 1_000_000) * USD_PER_1M_INPUT +
    (usage.outputTokens / 1_000_000) * USD_PER_1M_OUTPUT
  return usd * USD_TO_INR
}

/**
 * F091: "Every AI call logs model, tokens in/out, latency, cost and purpose." `feature` is the
 * AI-layer function name from tab07 (AI-01/AI-05/AI-09, ...), not a free-text description, so the
 * dashboard can group by it exactly. household_id/student_id are both nullable on ai_jobs
 * (0055_ai_jobs_student_scope) because AI-01 (bank question generation) is admin/global content
 * authoring with neither attached -- that row still logs cost and latency, it just can't be
 * attributed "by student" per the AC, which is the honest answer rather than a fabricated owner.
 *
 * Never throws: metering must never take down the AI feature it's observing. A failed write is
 * logged to stderr and swallowed.
 */
export async function logAiJob(
  db: Db,
  input: {
    feature: string
    model: string
    householdId?: string | null
    studentId?: string | null
    tokensIn?: number | null
    tokensOut?: number | null
    latencyMs: number
    status: AiJobStatus
    error?: string | null
  },
): Promise<void> {
  const costInr =
    input.tokensIn != null && input.tokensOut != null
      ? estimateCostInr({
          inputTokens: input.tokensIn,
          outputTokens: input.tokensOut,
        })
      : null
  try {
    await aiJobsRepository.insert(db, {
      household_id: input.householdId ?? null,
      student_id: input.studentId ?? null,
      feature: input.feature,
      model: input.model,
      tokens_in: input.tokensIn ?? null,
      tokens_out: input.tokensOut ?? null,
      cost_inr: costInr,
      latency_ms: input.latencyMs,
      status: input.status,
      error: input.error ?? null,
    })
  } catch (err) {
    console.error('logAiJob: failed to write ai_jobs row', err)
  }
}
