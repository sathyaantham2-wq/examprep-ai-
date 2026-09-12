import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { householdsRepository, studentsRepository } from '../db/repositories'
import { getProductFunnelReport, logProductEvent } from './product-events'

/**
 * F093: "Events: paper generated, downloaded, attempted, uploaded, evaluated, remediated; funnel
 * view; privacy-respecting, no third-party ad pixels." Seeds product_events directly (same
 * reasoning as ai_jobs tests elsewhere this session -- driving this through real HTTP routes is
 * covered separately in product-funnel.integration.test.ts) to prove the funnel shaping logic:
 * all six stages always present in order, distinct-actor counts (not raw event counts), and
 * percent-of-first-stage.
 */
describe('getProductFunnelReport (F093)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let studentA: Awaited<ReturnType<typeof studentsRepository.insert>>
  let studentB: Awaited<ReturnType<typeof studentsRepository.insert>>

  beforeAll(async () => {
    db = createDb()
    household = await householdsRepository.insert(db, {
      name: 'F093 Test Household',
      plan: 'free',
    })
    studentA = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F093 Kid A',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    studentB = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F093 Kid B',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })

    // Both students generate a paper (2 households->1, 2 students, but studentA generates twice).
    await logProductEvent(db, {
      eventType: 'paper_generated',
      householdId: household.id,
      studentId: studentA.id,
    })
    await logProductEvent(db, {
      eventType: 'paper_generated',
      householdId: household.id,
      studentId: studentA.id,
    })
    await logProductEvent(db, {
      eventType: 'paper_generated',
      householdId: household.id,
      studentId: studentB.id,
    })
    // Only studentA makes it to evaluation.
    await logProductEvent(db, {
      eventType: 'evaluation_completed',
      householdId: household.id,
      studentId: studentA.id,
    })
  })

  afterAll(async () => {
    await db.deleteFrom('product_events').where('household_id', '=', household.id).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.destroy()
  })

  it('reports all six funnel stages in order, even ones with zero events', async () => {
    const report = await getProductFunnelReport(db, {
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    })
    expect(report.stages.map((s) => s.event_type)).toEqual([
      'paper_generated',
      'paper_downloaded',
      'attempt_submitted',
      'attempt_uploaded',
      'evaluation_completed',
      'remediation_started',
    ])
    const downloaded = report.stages.find((s) => s.event_type === 'paper_downloaded')
    expect(downloaded?.households).toBe(0)
    expect(downloaded?.events).toBe(0)
  })

  it('counts distinct households/students per stage, not raw event counts', async () => {
    const report = await getProductFunnelReport(db, {
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    })
    const generated = report.stages.find((s) => s.event_type === 'paper_generated')
    expect(generated?.households).toBe(1) // one household, even though it generated 3 times
    expect(generated?.students).toBe(2) // both students generated at least once
    expect(generated?.events).toBe(3) // but the raw count still reflects all 3 calls
  })

  it('reports pct_of_first_stage relative to the first stage, null for the first stage itself', async () => {
    const report = await getProductFunnelReport(db, {
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    })
    expect(report.stages[0].pct_of_first_stage).toBeNull()
    const evaluated = report.stages.find((s) => s.event_type === 'evaluation_completed')
    // 1 of 1 household that generated a paper also reached evaluation -> 100%.
    expect(evaluated?.pct_of_first_stage).toBe(100)
  })

  it('never throws when the write itself fails, same as logAiJob', async () => {
    await expect(
      logProductEvent(db, {
        // @ts-expect-error deliberately invalid to exercise the swallow-and-log path
        eventType: 'not-a-real-event',
        householdId: household.id,
        studentId: studentA.id,
      }),
    ).resolves.toBeUndefined()
  })
})
