import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentByIdRoute } from './api/students/$id'
import { Route as GenerateRoute } from './api/papers/generate'

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

/**
 * F112 originally specified "within a daily quota" and this file proved it (generate up to 3,
 * the 4th refused with 429 daily_quota_exceeded). Removed 2026-09-24 at the user's explicit
 * request ("dont put any limits") -- see CLAUDE.md's Hard rules for the dated record and
 * src/routes/api/papers/generate.ts's own comment where the check used to be. This file now
 * proves the opposite: repeated same-day generation is never blocked by a count -- and keeps the
 * other, unrelated access-control assertions this route also carries (an explicit student_id is
 * still required for a parent/admin caller; a disabled student is still locked out; a student
 * still can't generate as anyone but herself), none of which were ever about the quota.
 */
describe('student self-service paper generation (F112) -- no daily count limit', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string
  let questionId: string
  let otherStudentId: string
  const paperIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('quota')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Quota Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession('quota-student', parent.householdId, studentId)

    // A second student under the same household -- proves generation for one never touches the
    // other's, same as before this file was about a quota.
    const otherResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Quota Kid Two',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    otherStudentId = (await otherResponse.json()).id

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
    chapterId = chapter.id

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.QUOTA-${Date.now()}`,
      name: 'Quota fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    const question = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Quota fixture question',
      answer: '1',
      created_by: 'quota-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    questionId = question.id

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Quota fixture blueprint',
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 1,
          count: 1,
          bloom_allowed: ['Remember'],
        },
      ]),
      bloom_targets: JSON.stringify({
        Remember: 100,
        Understand: 0,
        Apply: 0,
        Analyse: 0,
        Evaluate: 0,
        Create: 0,
      }),
    })
    blueprintId = blueprint.id
  })

  afterAll(async () => {
    if (paperIds.length > 0) {
      await db
        .deleteFrom('paper_questions')
        .where('paper_id', 'in', paperIds)
        .execute()
    }
    await db
      .deleteFrom('generation_events')
      .where('student_id', 'in', [studentId, otherStudentId])
      .execute()
    await db
      .deleteFrom('papers')
      .where('student_id', 'in', [studentId, otherStudentId])
      .execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  function generate(cookie: string, body: Record<string, unknown> = {}) {
    return handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(cookie, {
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
        ...body,
      }),
    })
  }

  it('a student can generate the same paper well past the old 3-a-day limit, none refused', async () => {
    // The old quota was 3; 6 in a row with no 429 is the direct proof it is gone, not just raised.
    for (let i = 0; i < 6; i++) {
      const response = await generate(student.cookie)
      expect(response.status).toBe(201)
      const body = await response.json()
      paperIds.push(body.paper.id)
      expect(body.paper.student_id).toBe(studentId)
    }
  })

  it('generation for one student never touches the other, same as before', async () => {
    const otherSession = await createStudentSession(
      'quota-student-two',
      parent.householdId,
      otherStudentId,
    )
    const response = await generate(otherSession.cookie)
    expect(response.status).toBe(201)
    const body = await response.json()
    paperIds.push(body.paper.id)
  })

  it("the parent generating for this student isn't blocked by anything the student's own calls did", async () => {
    const response = await generate(parent.cookie, { student_id: studentId })
    expect(response.status).toBe(201)
    const body = await response.json()
    paperIds.push(body.paper.id)
  })

  it('a body-supplied student_id is still ignored for a student caller -- always generates as themselves', async () => {
    const response = await generate(student.cookie, { student_id: otherStudentId })
    expect(response.status).toBe(201)
    const body = await response.json()
    paperIds.push(body.paper.id)
    // Not otherStudentId, despite the body -- F010's identity rule, unrelated to the old quota.
    expect(body.paper.student_id).toBe(studentId)
  })

  it('parent/admin still needs an explicit student_id', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    expect(response.status).toBe(400)
  })

  it('a disabled (F010) student is locked out of self-service generation too', async () => {
    await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, { access_enabled: false }),
      params: { id: studentId },
    })

    const response = await generate(student.cookie)
    expect(response.status).toBe(423)

    // Restore for cleanliness / in case this file's fixtures are ever re-run against a persistent
    // student row.
    await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, { access_enabled: true }),
      params: { id: studentId },
    })
  })
})
