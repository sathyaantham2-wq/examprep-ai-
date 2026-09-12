import type { Db } from '../db/connection'
import type { AiJobStatus } from '../db/enums'
import { aiJobsRepository, notificationsRepository } from '../db/repositories'

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

// F092: tab03's AC names "daily caps" and an "80%" alert threshold but not the actual numbers --
// picked generously above any realistic single day of use (a household running a handful of
// evaluations/remediations, an admin running a generation batch) so these are a circuit breaker
// against a runaway loop (the feature's own user story), not a routine limit anyone should hit by
// normal use. "Per-user" is mapped to per-household: a household is this product's account unit
// (one parent + their students), and F121 already owns a separate, more specific per-student cap.
export const GLOBAL_DAILY_AI_CALL_CAP = 500
export const PER_HOUSEHOLD_DAILY_AI_CALL_CAP = 60
const CAP_ALERT_THRESHOLD = 0.8

export class AiCapReachedError extends Error {
  readonly scope: 'global' | 'household'
  constructor(scope: 'global' | 'household') {
    super(
      scope === 'global'
        ? "Today's AI usage limit has been reached across the whole app. Please try again tomorrow."
        : "Today's AI usage limit has been reached for this household. Please try again tomorrow.",
    )
    this.scope = scope
  }
}

function startOfTodayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * F092: "alert to admin at 80%." Idempotent per scope per day -- the template string embeds the
 * date (and household id, for a household-scoped alert), so the very first caller to cross 80% on
 * a given day writes it and every later call that day is a no-op, rather than paging admin once
 * per AI call for the rest of the day.
 */
async function alertAdminOnce(
  db: Db,
  templateKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const already = await db
    .selectFrom('notifications')
    .select('id')
    .where('template', '=', templateKey)
    .executeTakeFirst()
  if (already) return

  const admins = await db.selectFrom('users').select('id').where('role', '=', 'admin').execute()
  for (const admin of admins) {
    await notificationsRepository.insert(db, {
      user_id: admin.id,
      channel: 'in_app',
      template: templateKey,
      payload: JSON.stringify(payload),
      status: 'queued',
    })
  }
}

/**
 * F092: "Per-user and global daily caps on generation and evaluation calls; graceful message on
 * limit, alert to admin at 80%." Every AI-*.ts function calls this before it spends anything.
 * Throws AiCapReachedError when a cap is hit; every caller already has a documented fallback for
 * "AI unavailable" (manual marking / bank fallback / admin writes manually) from when
 * ANTHROPIC_API_KEY isn't configured, so callers catch this one error type and degrade into that
 * same path instead of a raw 500 -- that degrade *is* the AC's "graceful message on limit".
 */
export async function enforceAiCallBudget(
  db: Db,
  input: { feature: string; model: string; householdId: string | null; studentId?: string | null },
): Promise<void> {
  const today = startOfTodayUtc()
  const since = new Date(`${today}T00:00:00.000Z`)

  const globalCount = await aiJobsRepository.countSince(db, since)
  if (globalCount >= GLOBAL_DAILY_AI_CALL_CAP) {
    await logAiJob(db, {
      feature: input.feature,
      model: input.model,
      householdId: input.householdId,
      studentId: input.studentId,
      latencyMs: 0,
      status: 'error',
      error: 'Daily global AI call cap reached',
    })
    throw new AiCapReachedError('global')
  }
  if (globalCount >= GLOBAL_DAILY_AI_CALL_CAP * CAP_ALERT_THRESHOLD) {
    await alertAdminOnce(db, `ai_cap_80pct_global_${today}`, {
      scope: 'global',
      count: globalCount,
      cap: GLOBAL_DAILY_AI_CALL_CAP,
    })
  }

  if (input.householdId) {
    const householdCount = await aiJobsRepository.countSince(db, since, input.householdId)
    if (householdCount >= PER_HOUSEHOLD_DAILY_AI_CALL_CAP) {
      await logAiJob(db, {
        feature: input.feature,
        model: input.model,
        householdId: input.householdId,
        studentId: input.studentId,
        latencyMs: 0,
        status: 'error',
        error: 'Daily household AI call cap reached',
      })
      throw new AiCapReachedError('household')
    }
    if (householdCount >= PER_HOUSEHOLD_DAILY_AI_CALL_CAP * CAP_ALERT_THRESHOLD) {
      await alertAdminOnce(db, `ai_cap_80pct_household_${input.householdId}_${today}`, {
        scope: 'household',
        household_id: input.householdId,
        count: householdCount,
        cap: PER_HOUSEHOLD_DAILY_AI_CALL_CAP,
      })
    }
  }
}

// F121: tab03 doesn't name a number either -- picked so a normal week of self-service use (a
// student generating a paper or two and getting them graded) sits comfortably under the daily
// figure, while the monthly figure is a real ceiling below "daily cap x 30" rather than a no-op,
// since not every day is used. A parent can raise either via PATCH /api/students/:id
// (generation_daily_cap_inr / generation_monthly_cap_inr) -- null there means "use this default".
export const STUDENT_DAILY_GENERATION_COST_CAP_INR = 15
export const STUDENT_MONTHLY_GENERATION_COST_CAP_INR = 150

export class StudentSpendCapReachedError extends Error {
  readonly period: 'daily' | 'monthly'
  constructor(period: 'daily' | 'monthly') {
    super(
      period === 'daily'
        ? "Today's AI spend limit for this student has been reached. Ask a parent to raise it, or try again tomorrow."
        : "This month's AI spend limit for this student has been reached. Ask a parent to raise it, or try again next month.",
    )
    this.period = period
  }
}

function startOfMonthUtc(): Date {
  const today = new Date().toISOString().slice(0, 10)
  return new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`)
}

/**
 * F121: "Daily and monthly caps per student on paper generation and evaluation." Scoped to
 * AI-01 (self-service generation, F112) and AI-05 (grading of that student's own attempts) --
 * the two AI-layer calls this AC actually names; AI-09 (remediation content) is cached per-concept
 * and shared across every student who needs it (F067), so it is deliberately not charged against
 * any one student's cap here.
 *
 * "Admin alerted at 80% of the household cap" is F092's own PER_HOUSEHOLD_DAILY_AI_CALL_CAP alert
 * (enforceAiCallBudget already fires it whenever this student's calls push the household over that
 * threshold) -- F121 doesn't need a second alert path, only the per-student spend ceiling itself.
 */
export async function enforceStudentSpendBudget(
  db: Db,
  input: { studentId: string },
): Promise<void> {
  const student = await db
    .selectFrom('students')
    .select(['generation_daily_cap_inr', 'generation_monthly_cap_inr'])
    .where('id', '=', input.studentId)
    .executeTakeFirstOrThrow()
  const dailyCap =
    student.generation_daily_cap_inr != null
      ? Number(student.generation_daily_cap_inr)
      : STUDENT_DAILY_GENERATION_COST_CAP_INR
  const monthlyCap =
    student.generation_monthly_cap_inr != null
      ? Number(student.generation_monthly_cap_inr)
      : STUDENT_MONTHLY_GENERATION_COST_CAP_INR

  const dailySpend = await aiJobsRepository.sumCostForStudentSince(
    db,
    input.studentId,
    new Date(`${startOfTodayUtc()}T00:00:00.000Z`),
  )
  if (dailySpend >= dailyCap) {
    throw new StudentSpendCapReachedError('daily')
  }

  const monthlySpend = await aiJobsRepository.sumCostForStudentSince(
    db,
    input.studentId,
    startOfMonthUtc(),
  )
  if (monthlySpend >= monthlyCap) {
    throw new StudentSpendCapReachedError('monthly')
  }
}
