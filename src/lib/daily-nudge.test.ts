import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  conceptStatusRepository,
  householdsRepository,
  studentsRepository,
} from '../db/repositories'
import { generateOrGetTodayNudge, markNudgeStatus } from './daily-nudge'

/**
 * F082: "A single concrete action derived from the latest diagnosis, delivered once daily,
 * marked done or skipped." Real DB -- concept_status drives getRankedActions (src/lib/
 * diagnosis.ts), which this feature reuses rather than duplicating.
 */
describe('generateOrGetTodayNudge / markNudgeStatus (F082)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let studentId: string
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    household = await householdsRepository.insert(db, {
      name: 'F082 Test Household',
      plan: 'free',
    })
    const student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F082 Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    studentId = student.id

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const chapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .where('chapter_no', '=', 1)
      .executeTakeFirstOrThrow()

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.F082-${Date.now()}`,
      name: 'F082 fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id
    await conceptStatusRepository.upsert(db, {
      student_id: studentId,
      concept_id: conceptId,
      status: 'Priority',
    })
  })

  afterAll(async () => {
    await db.deleteFrom('daily_nudges').where('student_id', '=', studentId).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('generates an action naming the top Priority/Weak concept', async () => {
    const nudge = await generateOrGetTodayNudge(db, studentId)
    expect(nudge.status).toBe('pending')
    expect(nudge.concept_id).toBe(conceptId)
    expect(nudge.action_text).toContain('F082 fixture concept')
  })

  it('is idempotent for the same day -- a second call returns the same row, not a new one', async () => {
    const first = await generateOrGetTodayNudge(db, studentId)
    const second = await generateOrGetTodayNudge(db, studentId)
    expect(second.id).toBe(first.id)

    const rows = await db
      .selectFrom('daily_nudges')
      .selectAll()
      .where('student_id', '=', studentId)
      .execute()
    expect(rows).toHaveLength(1)
  })

  it('marks a nudge done, and the mark survives regenerating the same day', async () => {
    const nudge = await generateOrGetTodayNudge(db, studentId)
    const marked = await markNudgeStatus(db, studentId, nudge.id, 'done')
    expect(marked?.status).toBe('done')

    const regenerated = await generateOrGetTodayNudge(db, studentId)
    expect(regenerated.id).toBe(nudge.id)
    expect(regenerated.status).toBe('done')
  })

  it('returns null when marking a nudge that belongs to a different student', async () => {
    const otherHousehold = await householdsRepository.insert(db, {
      name: 'F082 Other Household',
      plan: 'free',
    })
    const otherStudent = await studentsRepository.insert(db, {
      household_id: otherHousehold.id,
      name: 'F082 Other Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    const nudge = await generateOrGetTodayNudge(db, studentId)
    const result = await markNudgeStatus(db, otherStudent.id, nudge.id, 'done')
    expect(result).toBeNull()

    await db.deleteFrom('daily_nudges').where('student_id', '=', otherStudent.id).execute()
    await db.deleteFrom('households').where('id', '=', otherHousehold.id).execute()
  })

  it('falls back to the documented "no action" text when nothing is Priority/Weak', async () => {
    const household2 = await householdsRepository.insert(db, {
      name: 'F082 Clean Household',
      plan: 'free',
    })
    const student2 = await studentsRepository.insert(db, {
      household_id: household2.id,
      name: 'F082 Clean Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    const nudge = await generateOrGetTodayNudge(db, student2.id)
    expect(nudge.concept_id).toBeNull()
    expect(nudge.action_text).toMatch(/keep up the current pace/i)

    await db.deleteFrom('daily_nudges').where('student_id', '=', student2.id).execute()
    await db.deleteFrom('households').where('id', '=', household2.id).execute()
  })
})
