import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as PdfRoute } from './api/papers/$id/pdf'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as ProductFunnelRoute } from './api/admin/product-funnel'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  const handlers = (route.options.server as { handlers: Record<string, RouteHandler> }).handlers
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
 * F093: "Events: paper generated, downloaded, attempted, uploaded, evaluated, remediated; funnel
 * view." Drives the real generate / PDF-download / submit routes and checks each logs its own
 * product_events row and that GET /api/admin/product-funnel reflects it -- product-events.test.ts
 * already covers the funnel-shaping logic in isolation, this is the end-to-end wiring proof.
 */
describe('paper lifecycle events feed the admin funnel (F093)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string
  let questionId: string
  let paperId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('funnel-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('funnel-parent')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Funnel Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession('funnel-student', parent.householdId, studentId)

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
      code: `C7M-1.FUNNEL-${Date.now()}`,
      name: 'Funnel fixture concept',
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
      text: 'Funnel fixture question',
      answer: '1',
      created_by: 'funnel-fixture',
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
      name: 'Funnel fixture blueprint',
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([
        { name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] },
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
    if (paperId) {
      await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
    }
    await db.deleteFrom('product_events').where('household_id', '=', parent.householdId).execute()
    await db.deleteFrom('generation_events').where('student_id', '=', studentId).execute()
    await db.deleteFrom('attempts').where('student_id', '=', studentId).execute()
    await db.deleteFrom('papers').where('student_id', '=', studentId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('generating a paper logs paper_generated', async () => {
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
    expect(response.status).toBe(201)
    paperId = (await response.json()).paper.id

    const rows = await db
      .selectFrom('product_events')
      .selectAll()
      .where('household_id', '=', parent.householdId)
      .where('event_type', '=', 'paper_generated')
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].student_id).toBe(studentId)
  })

  it('downloading the PDF logs paper_downloaded', async () => {
    const response = await handlerFor(
      PdfRoute,
      'GET',
    )({ request: request(parent.cookie), params: { id: paperId } })
    expect(response.status).toBe(200)

    const rows = await db
      .selectFrom('product_events')
      .selectAll()
      .where('household_id', '=', parent.householdId)
      .where('event_type', '=', 'paper_downloaded')
      .execute()
    expect(rows).toHaveLength(1)
  })

  it('submitting the attempt logs attempt_submitted', async () => {
    const attempt = await db
      .insertInto('attempts')
      .values({ paper_id: paperId, student_id: studentId, mode: 'online', status: 'in_progress' })
      .returningAll()
      .executeTakeFirstOrThrow()

    const response = await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, { confirm_blanks: true }),
      params: { id: attempt.id },
    })
    expect(response.status).toBe(200)

    const rows = await db
      .selectFrom('product_events')
      .selectAll()
      .where('household_id', '=', parent.householdId)
      .where('event_type', '=', 'attempt_submitted')
      .execute()
    expect(rows).toHaveLength(1)
  })

  it('the admin funnel reflects every stage reached, with zero-count stages still present', async () => {
    const response = await handlerFor(
      ProductFunnelRoute,
      'GET',
    )({ request: request(admin.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.stages.map((s: { event_type: string }) => s.event_type)).toEqual([
      'paper_generated',
      'paper_downloaded',
      'attempt_submitted',
      'attempt_uploaded',
      'evaluation_completed',
      'remediation_started',
    ])
    const generated = body.stages.find((s: { event_type: string }) => s.event_type === 'paper_generated')
    expect(generated.households).toBeGreaterThanOrEqual(1)
    const uploaded = body.stages.find((s: { event_type: string }) => s.event_type === 'attempt_uploaded')
    expect(uploaded.events).toBe(0)
  })

  it('requires admin', async () => {
    const response = await handlerFor(ProductFunnelRoute, 'GET')({ request: request(parent.cookie) })
    expect(response.status).toBe(403)
  })
})
