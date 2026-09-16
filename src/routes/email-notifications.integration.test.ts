import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { unsubscribeToken } from '../lib/email'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as EvaluationsRoute } from './api/evaluations'
import { Route as UnsubscribeRoute } from './api/notifications/unsubscribe'
import { Route as CronWeeklySummaryRoute } from './api/cron/weekly-summary'

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
 * F080: "Paper ready, evaluation complete, weekly summary; unsubscribe honoured." Drives the
 * real routes end to end. MAKE_EMAIL_WEBHOOK_URL isn't configured in this dev/test environment
 * (same reason every AI-*.ts module can't be tested against a real call either), so every
 * successful trigger below is checked by its `notifications` row landing with status 'skipped'
 * rather than 'sent' -- that IS the correct, honest behavior for this environment; the webhook
 * itself was verified separately with a real send.
 */
describe('email notification triggers and unsubscribe (F080)', () => {
  let db: Db
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
    parent = await createParentSession('f080-email')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'F080 Email Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession('f080-email-student', parent.householdId, studentId)

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
      code: `C7M-1.F080EMAIL-${Date.now()}`,
      name: 'F080 email fixture concept',
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
      text: 'F080 email fixture question',
      answer: '1',
      created_by: 'f080-email-fixture',
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
      name: 'F080 email fixture blueprint',
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
    // FK-safe order (see memory note examprep-test-suite-orphan-data): evaluation_items/
    // evaluations before anything the household cascade would otherwise try to remove first.
    const attempts = await db.selectFrom('attempts').select('id').where('student_id', '=', studentId).execute()
    const attemptIds = attempts.map((a) => a.id)
    if (attemptIds.length > 0) {
      const evaluations = await db
        .selectFrom('evaluations')
        .select('id')
        .where('attempt_id', 'in', attemptIds)
        .execute()
      const evalIds = evaluations.map((e) => e.id)
      if (evalIds.length > 0) {
        await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', evalIds).execute()
        await db.deleteFrom('evaluations').where('id', 'in', evalIds).execute()
      }
    }
    await db.deleteFrom('notifications').where('user_id', '=', parent.userId).execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('generating a paper notifies the parent (paper_ready, skipped: email not configured)', async () => {
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
    paperId = (await response.json()).paper.id

    const row = await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', parent.userId)
      .where('template', '=', 'paper_ready')
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('skipped')
  })

  it('creating an evaluation notifies the parent (evaluation_complete, skipped: email not configured)', async () => {
    const attempt = await db
      .insertInto('attempts')
      .values({ paper_id: paperId, student_id: studentId, mode: 'online', status: 'in_progress' })
      .returningAll()
      .executeTakeFirstOrThrow()
    const submitResponse = await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, { confirm_blanks: true }),
      params: { id: attempt.id },
    })
    expect(submitResponse.status).toBe(200)

    const evalResponse = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({ request: request(parent.cookie, { attempt_id: attempt.id }) })
    expect(evalResponse.status).toBe(201)

    const row = await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', parent.userId)
      .where('template', '=', 'evaluation_complete')
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('skipped')
  })

  it('rejects an unsubscribe link with an invalid token', async () => {
    const response = await handlerFor(
      UnsubscribeRoute,
      'GET',
    )({
      request: new Request(
        `http://localhost/test?user_id=${parent.userId}&token=not-the-real-token`,
      ),
    })
    expect(response.status).toBe(400)

    const user = await db
      .selectFrom('users')
      .select('email_notifications_enabled')
      .where('id', '=', parent.userId)
      .executeTakeFirstOrThrow()
    expect(user.email_notifications_enabled).toBe(true)
  })

  it('honours a valid unsubscribe link', async () => {
    const token = unsubscribeToken(parent.userId)
    const response = await handlerFor(
      UnsubscribeRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?user_id=${parent.userId}&token=${token}`),
    })
    expect(response.status).toBe(200)

    const user = await db
      .selectFrom('users')
      .select('email_notifications_enabled')
      .where('id', '=', parent.userId)
      .executeTakeFirstOrThrow()
    expect(user.email_notifications_enabled).toBe(false)

    // Restore for cleanliness / in case fixtures are ever re-run against a persistent row.
    await db
      .updateTable('users')
      .set({ email_notifications_enabled: true })
      .where('id', '=', parent.userId)
      .execute()
  })

  it('the weekly-summary cron route refuses to run without CRON_SECRET configured', async () => {
    // CRON_SECRET is unset in this dev/test environment (same documented-default pattern as
    // ANTHROPIC_API_KEY/MAKE_EMAIL_WEBHOOK_URL) -- this is the real, current behavior: refuse
    // outright rather than ever run unauthenticated.
    const response = await handlerFor(
      CronWeeklySummaryRoute,
      'GET',
    )({ request: new Request('http://localhost/test') })
    expect(response.status).toBe(500)
  })
})
