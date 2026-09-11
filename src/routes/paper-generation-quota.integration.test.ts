import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentByIdRoute } from './api/students/$id'
import {
  Route as GenerateRoute,
  STUDENT_DAILY_GENERATION_QUOTA,
} from './api/papers/generate'

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
 * F112: "Student role may generate ... papers within a daily quota." Passes
 * recent_usage_window_days: 0 on every generate call so the same single fixture question can be
 * reused across repeated generations without F026's recent-usage exclusion causing a shortfall --
 * the quota, not question supply, is what this test is proving.
 */
describe('student self-service paper generation with a daily quota (F112)', () => {
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

    // A second student under the same household to prove the quota is per-student, not
    // per-household.
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

  it('a student can generate up to the daily quota', async () => {
    let response
    for (let i = 0; i < STUDENT_DAILY_GENERATION_QUOTA; i++) {
      response = await handlerFor(
        GenerateRoute,
        'POST',
      )({
        request: request(student.cookie, {
          blueprint_id: blueprintId,
          chapter_ids: [chapterId],
          recent_usage_window_days: 0,
        }),
      })
      expect(response.status).toBe(201)
      const body = await response.json()
      paperIds.push(body.paper.id)
      expect(body.paper.student_id).toBe(studentId)
    }
  })

  it('the next generation past the quota is refused with 429', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(student.cookie, {
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body.error).toBe('daily_quota_exceeded')
  })

  it("the quota is per-student, not per-household -- the sibling student is unaffected", async () => {
    const otherSession = await createStudentSession(
      'quota-student-two',
      parent.householdId,
      otherStudentId,
    )
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(otherSession.cookie, {
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    paperIds.push(body.paper.id)
  })

  it("the parent generating for this student isn't blocked by the student's own quota", async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    paperIds.push(body.paper.id)
  })

  it('a body-supplied student_id is ignored for a student caller -- always generates as themselves', async () => {
    // This student is already at quota from the earlier test, so the body's student_id override
    // attempt is expected to be refused for THIS student's own quota, not silently redirected to
    // otherStudentId.
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(student.cookie, {
        student_id: otherStudentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    expect(response.status).toBe(429)
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

    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(student.cookie, {
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
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
