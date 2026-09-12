import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { householdsRepository, studentsRepository } from '../db/repositories'
import { estimateCostInr, logAiJob } from './ai-metering'

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
