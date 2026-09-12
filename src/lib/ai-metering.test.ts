import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  aiJobsRepository,
  householdsRepository,
  studentsRepository,
} from '../db/repositories'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import {
  AiCapReachedError,
  GLOBAL_DAILY_AI_CALL_CAP,
  PER_HOUSEHOLD_DAILY_AI_CALL_CAP,
  STUDENT_DAILY_GENERATION_COST_CAP_INR,
  STUDENT_MONTHLY_GENERATION_COST_CAP_INR,
  StudentSpendCapReachedError,
  enforceAiCallBudget,
  enforceStudentSpendBudget,
  estimateCostInr,
  logAiJob,
} from './ai-metering'

describe('estimateCostInr (F091 / F116 cost cap)', () => {
  it('prices at Claude Sonnet 5 published rates ($2/$10 per 1M tokens) converted to INR', () => {
    const cost = estimateCostInr({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    // (2 + 10) USD * 83 INR/USD
    expect(cost).toBeCloseTo(12 * 83, 5)
  })

  it('scales linearly and returns 0 for no usage', () => {
    expect(estimateCostInr({ inputTokens: 0, outputTokens: 0 })).toBe(0)
    const small = estimateCostInr({ inputTokens: 1000, outputTokens: 500 })
    const double = estimateCostInr({ inputTokens: 2000, outputTokens: 1000 })
    expect(double).toBeCloseTo(small * 2, 8)
  })
})

/**
 * F091: "Every AI call logs model, tokens in/out, latency, cost and purpose." Covers logAiJob's
 * two real shapes -- a household+student-attributed call (AI-05/AI-09) and an unattributed one
 * (AI-01, admin bank generation) -- plus that a DB failure never throws back into the AI call it's
 * observing.
 */
describe('logAiJob (F091)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let student: Awaited<ReturnType<typeof studentsRepository.insert>>

  beforeAll(async () => {
    db = createDb()
    household = await householdsRepository.insert(db, {
      name: 'F091 Test Household',
      plan: 'free',
    })
    student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F091 Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
  })

  afterAll(async () => {
    await db.deleteFrom('ai_jobs').where('household_id', '=', household.id).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.destroy()
  })

  it('writes a success row attributed to a household and student, with cost derived from usage', async () => {
    await logAiJob(db, {
      feature: 'AI-05',
      model: 'claude-sonnet-5',
      householdId: household.id,
      studentId: student.id,
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      latencyMs: 842,
      status: 'success',
    })

    const row = await db
      .selectFrom('ai_jobs')
      .selectAll()
      .where('household_id', '=', household.id)
      .where('feature', '=', 'AI-05')
      .executeTakeFirstOrThrow()
    expect(row.student_id).toBe(student.id)
    expect(row.tokens_in).toBe(1_000_000)
    expect(row.tokens_out).toBe(1_000_000)
    expect(Number(row.cost_inr)).toBeCloseTo(12 * 83, 2)
    expect(row.latency_ms).toBe(842)
    expect(row.status).toBe('success')
  })

  it('writes an error row with null cost when there is no usage to price', async () => {
    await logAiJob(db, {
      feature: 'AI-09',
      model: 'claude-sonnet-5',
      householdId: household.id,
      studentId: student.id,
      latencyMs: 120,
      status: 'error',
      error: 'network timeout',
    })

    const row = await db
      .selectFrom('ai_jobs')
      .selectAll()
      .where('household_id', '=', household.id)
      .where('feature', '=', 'AI-09')
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('error')
    expect(row.error).toBe('network timeout')
    expect(row.cost_inr).toBeNull()
    expect(row.tokens_in).toBeNull()
  })

  it('logs AI-01 (bank generation) with no household or student -- an honest "no owner", not a guess', async () => {
    await logAiJob(db, {
      feature: 'AI-01',
      model: 'claude-sonnet-5',
      householdId: null,
      studentId: null,
      tokensIn: 500,
      tokensOut: 200,
      latencyMs: 400,
      status: 'success',
    })

    const row = await db
      .selectFrom('ai_jobs')
      .selectAll()
      .where('feature', '=', 'AI-01')
      .where('household_id', 'is', null)
      .executeTakeFirstOrThrow()
    expect(row.student_id).toBeNull()
    await db.deleteFrom('ai_jobs').where('id', '=', row.id).execute()
  })

  it('never throws when the write itself fails', async () => {
    // status is constrained to success/error/pending -- an invalid value forces a real DB error.
    await expect(
      logAiJob(db, {
        feature: 'AI-05',
        model: 'claude-sonnet-5',
        householdId: household.id,
        // @ts-expect-error deliberately invalid to exercise the swallow-and-log path
        status: 'not-a-real-status',
        latencyMs: 1,
      }),
    ).resolves.toBeUndefined()
  })
})

function fillerRows(count: number, householdId: string | null) {
  return Array.from({ length: count }, () => ({
    household_id: householdId,
    feature: 'F092-TEST-FILLER',
    model: 'x',
    status: 'success' as const,
    latency_ms: 1,
  }))
}

/**
 * F092: "Per-user and global daily caps on generation and evaluation calls; graceful message on
 * limit, alert to admin at 80%." Drives enforceAiCallBudget directly (not through the gated
 * AI-*.ts functions, which short-circuit before ever reaching it when ANTHROPIC_API_KEY isn't
 * configured -- true in this dev environment, same reason ai-grading.ts etc. have no test file of
 * their own) with bulk-inserted filler rows so a 60-row household cap and a 500-row global cap are
 * both cheap to actually reach.
 */
describe('enforceAiCallBudget (F092)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let admin: TestSession
  const todayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)

  beforeAll(async () => {
    db = createDb()
    household = await householdsRepository.insert(db, {
      name: 'F092 Test Household',
      plan: 'free',
    })
    admin = await createParentSession('f092-admin')
    await promoteToAdmin(admin.userId)
  })

  afterAll(async () => {
    await db.deleteFrom('notifications').where('user_id', '=', admin.userId).execute()
    await db.deleteFrom('ai_jobs').where('household_id', '=', household.id).execute()
    await db
      .deleteFrom('ai_jobs')
      .where('household_id', 'is', null)
      .where('feature', 'in', ['F092-TEST-FILLER', 'AI-05'])
      .where('created_at', '>=', todayStart)
      .execute()
    await db.deleteFrom('households').where('id', 'in', [household.id, admin.householdId]).execute()
    await db.destroy()
  })

  it('allows a call well under both caps', async () => {
    await expect(
      enforceAiCallBudget(db, { feature: 'AI-05', model: 'x', householdId: household.id }),
    ).resolves.toBeUndefined()
  })

  it('throws AiCapReachedError and logs a rejected row once the household cap is reached', async () => {
    const current = await aiJobsRepository.countSince(db, todayStart, household.id)
    const need = Math.max(0, PER_HOUSEHOLD_DAILY_AI_CALL_CAP - current)
    if (need > 0) {
      await db.insertInto('ai_jobs').values(fillerRows(need, household.id)).execute()
    }

    await expect(
      enforceAiCallBudget(db, { feature: 'AI-05', model: 'x', householdId: household.id }),
    ).rejects.toThrow(AiCapReachedError)

    const rejectedRow = await db
      .selectFrom('ai_jobs')
      .selectAll()
      .where('household_id', '=', household.id)
      .where('error', '=', 'Daily household AI call cap reached')
      .executeTakeFirst()
    expect(rejectedRow).toBeTruthy()
  })

  it('alerts admin exactly once when a household crosses 80% of its cap, even across repeated calls', async () => {
    const freshHousehold = await householdsRepository.insert(db, {
      name: 'F092 Fresh Household',
      plan: 'free',
    })
    const today = new Date().toISOString().slice(0, 10)
    const templateKey = `ai_cap_80pct_household_${freshHousehold.id}_${today}`
    try {
      const eightyPct = Math.ceil(PER_HOUSEHOLD_DAILY_AI_CALL_CAP * 0.8)
      await db.insertInto('ai_jobs').values(fillerRows(eightyPct, freshHousehold.id)).execute()

      await enforceAiCallBudget(db, {
        feature: 'AI-05',
        model: 'x',
        householdId: freshHousehold.id,
      })
      await enforceAiCallBudget(db, {
        feature: 'AI-05',
        model: 'x',
        householdId: freshHousehold.id,
      })

      const notifications = await db
        .selectFrom('notifications')
        .selectAll()
        .where('template', '=', templateKey)
        .execute()
      // Exactly one row per admin that exists right now -- this shared dev DB can carry admin
      // fixtures left by other test files, so the meaningful assertion is "one call's worth, not
      // duplicated by the second call" rather than a hardcoded admin count.
      const adminCount = await db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('role', '=', 'admin')
        .executeTakeFirstOrThrow()
      expect(notifications).toHaveLength(Number(adminCount.c))
      expect(notifications.map((n) => n.user_id)).toContain(admin.userId)
      expect(notifications[0].channel).toBe('in_app')
    } finally {
      await db.deleteFrom('notifications').where('template', '=', templateKey).execute()
      await db.deleteFrom('ai_jobs').where('household_id', '=', freshHousehold.id).execute()
      await db.deleteFrom('households').where('id', '=', freshHousehold.id).execute()
    }
  })

  it('throws when the global cap is reached, regardless of how many other rows already exist today', async () => {
    const currentGlobal = await aiJobsRepository.countSince(db, todayStart)
    const need = Math.max(0, GLOBAL_DAILY_AI_CALL_CAP - currentGlobal)
    if (need > 0) {
      await db.insertInto('ai_jobs').values(fillerRows(need, null)).execute()
    }

    await expect(
      enforceAiCallBudget(db, { feature: 'AI-05', model: 'x', householdId: null }),
    ).rejects.toThrow(AiCapReachedError)
  })
})

/**
 * F121: "Daily and monthly caps per student on paper generation and evaluation ... parent can
 * raise the cap." Seeds ai_jobs.cost_inr directly (real spend rows), same reasoning as
 * enforceAiCallBudget's tests above -- ANTHROPIC_API_KEY isn't configured in this dev
 * environment, so this is the only way to actually reach a cap without a live model call.
 */
describe('enforceStudentSpendBudget (F121)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let student: Awaited<ReturnType<typeof studentsRepository.insert>>

  beforeAll(async () => {
    db = createDb()
    household = await householdsRepository.insert(db, {
      name: 'F121 Test Household',
      plan: 'free',
    })
    student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F121 Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
  })

  afterAll(async () => {
    await db.deleteFrom('ai_jobs').where('student_id', '=', student.id).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.destroy()
  })

  it('allows a call when the student has spent nothing yet', async () => {
    await expect(
      enforceStudentSpendBudget(db, { studentId: student.id }),
    ).resolves.toBeUndefined()
  })

  it('throws a daily StudentSpendCapReachedError once the default daily cap is reached', async () => {
    await db
      .insertInto('ai_jobs')
      .values({
        household_id: household.id,
        student_id: student.id,
        feature: 'AI-01',
        model: 'x',
        status: 'success',
        latency_ms: 1,
        cost_inr: STUDENT_DAILY_GENERATION_COST_CAP_INR,
      })
      .execute()

    const error = await enforceStudentSpendBudget(db, { studentId: student.id }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(StudentSpendCapReachedError)
    expect((error as InstanceType<typeof StudentSpendCapReachedError>).period).toBe('daily')
  })

  it("a parent-raised override lets the same student through, since it's above their default cap now", async () => {
    await studentsRepository.update(db, household.id, student.id, {
      generation_daily_cap_inr: STUDENT_DAILY_GENERATION_COST_CAP_INR * 10,
    })
    await expect(
      enforceStudentSpendBudget(db, { studentId: student.id }),
    ).resolves.toBeUndefined()
    // Restore the default (null) and clear today's spend so the next test starts from zero --
    // it needs to prove the monthly cap alone, without today's own row also tripping the daily one.
    await studentsRepository.update(db, household.id, student.id, {
      generation_daily_cap_inr: null,
    })
    await db.deleteFrom('ai_jobs').where('student_id', '=', student.id).execute()
  })

  it('throws a monthly StudentSpendCapReachedError when spend earlier this month already reached it, even with nothing spent today', async () => {
    // Backdated to the 1st of this month (not today), so today's own daily-cap check sees zero
    // spend and only the monthly check -- which sums the whole month -- can trip.
    const firstOfMonth = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`)
    await db
      .insertInto('ai_jobs')
      .values({
        household_id: household.id,
        student_id: student.id,
        feature: 'AI-01',
        model: 'x',
        status: 'success',
        latency_ms: 1,
        cost_inr: STUDENT_MONTHLY_GENERATION_COST_CAP_INR,
        created_at: firstOfMonth,
      })
      .execute()

    const error = await enforceStudentSpendBudget(db, { studentId: student.id }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(StudentSpendCapReachedError)
    expect((error as InstanceType<typeof StudentSpendCapReachedError>).period).toBe('monthly')
  })
})
