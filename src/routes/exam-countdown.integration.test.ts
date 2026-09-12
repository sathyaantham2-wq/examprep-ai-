import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, conceptStatusRepository, chaptersRepository } from '../db/repositories'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as ExamCountdownRoute } from './api/exam-countdown'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(
  route: { options: { server?: unknown } },
  method: string,
): RouteHandler {
  const handlers = (
    route.options.server as { handlers: Record<string, RouteHandler> }
  ).handlers
  return handlers[method]
}

function request(cookie: string, body?: unknown): Request {
  return new Request('http://localhost/test', {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * F078: "Countdown to each exam with % of syllabus concepts at Strong; highlights chapters
 * untested so far." Coverage is scoped to the student's whole (board, class) syllabus (real
 * seeded MATH-SEED data included), so this test asserts DELTAS from marking its own fixture
 * concepts rather than an absolute percentage -- the ambient seed/fixture concept count isn't
 * something a single test file controls or should assume.
 */
describe('exam countdown & syllabus coverage (F078)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let chapterId: string
  let conceptAId: string
  let conceptBId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('examcountdown')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Exam Countdown Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
        target_exams: [
          { name: 'Past Test', date: daysFromNow(-2) },
          { name: 'Unit Test', date: daysFromNow(3) },
          { name: 'Final Exam', date: daysFromNow(10) },
        ],
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'examcountdown-student',
      parent.householdId,
      studentId,
    )

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const existingChapter = await db
      .selectFrom('chapters')
      .select('source_id')
      .where('subject_id', '=', subject.id)
      .executeTakeFirstOrThrow()

    const chapter = await chaptersRepository.insert(db, {
      subject_id: subject.id,
      source_id: existingChapter.source_id,
      part: 'F078-TEST',
      chapter_no: 1,
      name: 'Exam countdown fixture chapter',
      order_index: 1,
    })
    chapterId = chapter.id

    const conceptA = await conceptsRepository.insert(db, {
      chapter_id: chapterId,
      board: 'CBSE',
      class: 7,
      code: `C7M-F078.A-${Date.now()}`,
      name: 'Exam countdown fixture concept A',
      difficulty_base: 'Easy',
    })
    conceptAId = conceptA.id
    const conceptB = await conceptsRepository.insert(db, {
      chapter_id: chapterId,
      board: 'CBSE',
      class: 7,
      code: `C7M-F078.B-${Date.now()}`,
      name: 'Exam countdown fixture concept B',
      difficulty_base: 'Easy',
    })
    conceptBId = conceptB.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('concept_status')
      .where('student_id', '=', studentId)
      .execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db
      .deleteFrom('concepts')
      .where('id', 'in', [conceptAId, conceptBId])
      .execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.destroy()
  })

  it('sorts countdowns soonest (including overdue) first, with correct days_remaining', async () => {
    const response = await handlerFor(
      ExamCountdownRoute,
      'GET',
    )({ request: request(student.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.countdowns.map((c: { exam_name: string }) => c.exam_name)).toEqual([
      'Past Test',
      'Unit Test',
      'Final Exam',
    ])
    expect(body.countdowns[0].days_remaining).toBe(-2)
    expect(body.countdowns[1].days_remaining).toBe(3)
    expect(body.countdowns[2].days_remaining).toBe(10)
  })

  it('a brand-new fixture chapter with no concept_status rows at all counts as untested', async () => {
    const response = await handlerFor(
      ExamCountdownRoute,
      'GET',
    )({ request: request(student.cookie) })
    const body = await response.json()
    const untestedIds = body.syllabus_coverage.untested_chapters.map(
      (c: { chapter_id: string }) => c.chapter_id,
    )
    expect(untestedIds).toContain(chapterId)
  })

  it('marking one concept Strong increases strong_concepts by exactly 1 and clears the chapter from untested', async () => {
    const before = await handlerFor(
      ExamCountdownRoute,
      'GET',
    )({ request: request(student.cookie) })
    const beforeBody = await before.json()
    const totalBefore = beforeBody.syllabus_coverage.total_concepts
    const strongBefore = beforeBody.syllabus_coverage.strong_concepts

    await conceptStatusRepository.upsert(db, {
      student_id: studentId,
      concept_id: conceptAId,
      status: 'Strong',
    })

    const after = await handlerFor(
      ExamCountdownRoute,
      'GET',
    )({ request: request(student.cookie) })
    const afterBody = await after.json()

    expect(afterBody.syllabus_coverage.total_concepts).toBe(totalBefore)
    expect(afterBody.syllabus_coverage.strong_concepts).toBe(strongBefore + 1)
    // Rating just ONE of the chapter's two concepts is enough to clear the whole chapter from
    // "untested" -- untested means zero attempts on the chapter, not full mastery of it.
    const untestedIds = afterBody.syllabus_coverage.untested_chapters.map(
      (c: { chapter_id: string }) => c.chapter_id,
    )
    expect(untestedIds).not.toContain(chapterId)
  })

  it("a Weak rating on the remaining concept doesn't move strong_concepts", async () => {
    const before = await handlerFor(
      ExamCountdownRoute,
      'GET',
    )({ request: request(student.cookie) })
    const strongBefore = (await before.json()).syllabus_coverage.strong_concepts

    await conceptStatusRepository.upsert(db, {
      student_id: studentId,
      concept_id: conceptBId,
      status: 'Weak',
    })

    const after = await handlerFor(
      ExamCountdownRoute,
      'GET',
    )({ request: request(student.cookie) })
    expect((await after.json()).syllabus_coverage.strong_concepts).toBe(
      strongBefore,
    )
  })

  it("another household can't reach this student's countdown", async () => {
    const otherParent = await createParentSession('examcountdown-other')
    const response = await handlerFor(
      ExamCountdownRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?student_id=${studentId}`, {
        headers: { cookie: otherParent.cookie },
      }),
    })
    expect(response.status).toBe(404)
    await db.deleteFrom('households').where('id', '=', otherParent.householdId).execute()
  })
})
