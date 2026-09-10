import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as AttemptAnswerRoute } from './api/attempts/$id/answer'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as EvaluationsRoute } from './api/evaluations'
import { Route as EvaluationConfirmRoute } from './api/evaluations/$id/confirm'
import { Route as StudentDashboardRoute } from './api/student-dashboard'

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
 * F072: two full generate -> attempt -> submit -> evaluate -> confirm rounds on the same concept
 * (first wrong, then right) to produce a real trend='up' row in concept_status, so
 * recent_improvements and mastery_pct both reflect genuine tracker state rather than a stub.
 */
describe('student dashboard (F072)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let conceptId: string
  let chapterId: string
  let blueprintId: string
  const evaluationIds: Array<string> = []
  const attemptIds: Array<string> = []
  const paperIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('student-dash')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Dashboard Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'student-dash-student',
      parent.householdId,
      studentId,
    )

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
      code: `C7M-1.STUDENTDASH-${Date.now()}`,
      name: 'Student dashboard fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    for (const suffix of ['a', 'b']) {
      await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `Student dashboard fixture question ${suffix}`,
        answer: '4',
        created_by: 'student-dash-fixture',
        options: [
          { label: 'A', text: '4', is_correct: true, order_index: 1 },
          { label: 'B', text: '5', is_correct: false, order_index: 2 },
        ],
      })
    }

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Student dashboard fixture blueprint',
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([
        { name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] },
      ]),
      bloom_targets: JSON.stringify({
        Remember: 100, Understand: 0, Apply: 0, Analyse: 0, Evaluate: 0, Create: 0,
      }),
    })
    blueprintId = blueprint.id

    for (const pickCorrect of [false, true]) {
      const generateResponse = await handlerFor(
        GenerateRoute,
        'POST',
      )({
        request: request(parent.cookie, {
          student_id: studentId,
          blueprint_id: blueprintId,
          chapter_ids: [chapterId],
        }),
      })
      const generated = await generateResponse.json()
      paperIds.push(generated.paper.id)

      const attemptResponse = await handlerFor(
        AttemptsRoute,
        'POST',
      )({
        request: request(student.cookie, {
          paper_id: generated.paper.id,
          mode: 'online',
        }),
      })
      const attemptId = (await attemptResponse.json()).id
      attemptIds.push(attemptId)

      const pq = generated.paperQuestions[0]
      await handlerFor(
        AttemptAnswerRoute,
        'PATCH',
      )({
        request: request(student.cookie, {
          paper_question_id: pq.id,
          selected_option: pickCorrect ? 'A' : 'B',
        }),
        params: { id: attemptId },
      })
      await handlerFor(
        AttemptSubmitRoute,
        'POST',
      )({ request: request(student.cookie, {}), params: { id: attemptId } })

      const evalResponse = await handlerFor(
        EvaluationsRoute,
        'POST',
      )({ request: request(parent.cookie, { attempt_id: attemptId }) })
      const evaluation = await evalResponse.json()
      evaluationIds.push(evaluation.evaluation.id)
      await handlerFor(
        EvaluationConfirmRoute,
        'POST',
      )({
        request: request(parent.cookie, {}),
        params: { id: evaluation.evaluation.id },
      })
    }
  })

  afterAll(async () => {
    await db
      .deleteFrom('concept_mastery')
      .where('concept_id', '=', conceptId)
      .execute()
    await db
      .deleteFrom('concept_status')
      .where('concept_id', '=', conceptId)
      .execute()
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', 'in', evaluationIds)
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('id', 'in', evaluationIds)
      .execute()
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', 'in', attemptIds)
      .execute()
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', 'in', paperIds)
      .execute()
    await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'student-dash-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('rejects an unauthenticated request', async () => {
    const response = await handlerFor(
      StudentDashboardRoute,
      'GET',
    )({ request: request('') })
    expect(response.status).toBe(401)
  })

  it('rejects a non-student (parent) request', async () => {
    const response = await handlerFor(
      StudentDashboardRoute,
      'GET',
    )({ request: request(parent.cookie) })
    expect(response.status).toBe(403)
  })

  it('reflects real tracker state: mastery, an up trend, and a streak day', async () => {
    const response = await handlerFor(
      StudentDashboardRoute,
      'GET',
    )({ request: request(student.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()

    const chapter = body.chapters.find((c: { chapter_id: string }) => c.chapter_id === chapterId)
    expect(chapter).toBeDefined()
    expect(chapter.mastery_pct).toBeGreaterThan(0)

    expect(
      body.recent_improvements.some((c: { concept_id: string }) => c.concept_id === conceptId),
    ).toBe(true)
    expect(body.streak_days).toBeGreaterThanOrEqual(1)
  })
})
