import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as QuestionsRoute } from './api/questions'

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
 * F026: "Per student, last_served_at and times_served; generator excludes questions served
 * within a configurable window." The exclusion logic already existed (generatePaper's default
 * 14-day window) but was never reachable through the real route -- only recentUsageWindowDays as
 * a direct function argument, which every test in this repo uses instead of the route. This
 * fixture deliberately has exactly one eligible question, so the exclusion window's effect (a
 * shortfall vs. no shortfall) is directly observable.
 */
describe('question usage history and configurable window (F026)', () => {
  let db: Db
  let parent: TestSession
  let admin: TestSession
  let studentId: string
  let questionId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('usage-parent')
    admin = await createParentSession('usage-admin')
    await promoteToAdmin(admin.userId)

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Usage Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id

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
      code: `C7M-1.USAGE-${Date.now()}`,
      name: 'Usage fixture concept',
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
      text: 'Usage fixture question',
      answer: '1',
      created_by: 'usage-fixture',
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
      name: 'Usage fixture blueprint',
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
    await db
      .deleteFrom('paper_questions')
      .where(
        'paper_id',
        'in',
        db
          .selectFrom('papers')
          .select('id')
          .where('student_id', '=', studentId),
      )
      .execute()
    await db.deleteFrom('papers').where('student_id', '=', studentId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parent.householdId, admin.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('the only eligible question gets used on first generation', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    expect(response.status).toBe(201)
    const generated = await response.json()
    expect(generated.paperQuestions).toHaveLength(1)
    expect(generated.shortfalls).toEqual([])
  })

  it('the default window excludes the just-served question, producing a shortfall', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    expect(response.status).toBe(201)
    const generated = await response.json()
    expect(generated.paperQuestions).toHaveLength(0)
    expect(generated.shortfalls.length).toBeGreaterThan(0)
  })

  it('recent_usage_window_days:0 makes the question eligible again through the real route', async () => {
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
    const generated = await response.json()
    expect(generated.paperQuestions).toHaveLength(1)
    expect(generated.shortfalls).toEqual([])
  })

  it('GET /api/questions?student_id=... reports times_served and last_served_at', async () => {
    const response = await handlerFor(
      QuestionsRoute,
      'GET',
    )({
      request: new Request(
        `http://localhost/test?concept=${conceptId}&student_id=${studentId}`,
        { headers: { cookie: admin.cookie } },
      ),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    const item = body.items.find((q: { id: string }) => q.id === questionId)
    expect(item.usage.times_served).toBe(2) // served in the 1st and 3rd generations above
    expect(item.usage.last_served_at).not.toBeNull()
  })
})
