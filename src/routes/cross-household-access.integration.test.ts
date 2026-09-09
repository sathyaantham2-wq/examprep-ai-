import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentByIdRoute } from './api/students/$id'
import { Route as StudentLoginRoute } from './api/students/$id/login'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as PaperByIdRoute } from './api/papers/$id'
import { Route as TrackerRoute } from './api/tracker/$studentId'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as AttemptAnswerRoute } from './api/attempts/$id/answer'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as EvaluationsRoute } from './api/evaluations'
import { Route as EvaluationItemRoute } from './api/evaluations/$id/items/$itemId'
import { Route as EvaluationConfirmRoute } from './api/evaluations/$id/confirm'
import { Route as EvaluationReportRoute } from './api/evaluations/$id/report'
import { Route as RegenerateSlotRoute } from './api/papers/$id/regenerate-slot'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

// Every route in this project uses the plain-object form of `server.handlers` (never the
// createHandlers-callback form), so this cast is safe — it exists purely because TypeScript's
// RouteOptions type has to allow both shapes generically.
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
 * F096: "every query filtered by household; automated test attempts cross-household access on
 * all endpoints and must fail." This calls the REAL route handler functions directly — no dev
 * server, no HTTP round trip — with genuine better-auth session cookies obtained through
 * auth.api.signUpEmail/signInEmail (src/db/test-helpers.ts), which is as close to "hit the actual
 * endpoint" as a test can get without a running process. This is also T01/T02 automated, closing
 * the auth-guard gap F103 left open.
 */
describe('cross-household access is denied on every route it was checked against (F096)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentA: TestSession
  let studentB: TestSession
  let studentAId: string
  let studentBId: string
  let paperId: string
  let paperQuestionId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string
  let attemptId: string
  let evaluationId: string
  let evaluationItemId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('f096-a')
    parentB = await createParentSession('f096-b')

    const studentAResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'F096 Kid A',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentAResponse.json()).id

    const studentBResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentB.cookie, {
        name: 'F096 Kid B',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentBId = (await studentBResponse.json()).id

    studentA = await createStudentSession(
      'f096-a-student',
      parentA.householdId,
      studentAId,
    )
    studentB = await createStudentSession(
      'f096-b-student',
      parentB.householdId,
      studentBId,
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
      code: `C7M-1.F096-${Date.now()}`,
      name: 'F096 fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'F096 fixture question',
      answer: '1',
      created_by: 'f096-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })

    // A second question of the identical shape (same concept/bloom/marks/type) so
    // POST /api/papers/:id/regenerate-slot has an eligible replacement to swap to.
    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'F096 fixture question (alternate)',
      answer: '1',
      created_by: 'f096-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'F096 fixture blueprint',
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

    const generateResponse = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        student_id: studentAId,
        blueprint_id: blueprint.id,
        chapter_ids: [chapter.id],
      }),
    })
    const generated = await generateResponse.json()
    paperId = generated.paper.id
    paperQuestionId = generated.paperQuestions[0].id

    // Student A actually attempts and submits, so there's a real attempt + evaluation to test
    // cross-household/cross-student denial against, not just papers.
    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(studentA.cookie, { paper_id: paperId, mode: 'online' }),
    })
    attemptId = (await attemptResponse.json()).id

    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(studentA.cookie, {
        paper_question_id: paperQuestionId,
        selected_option: 'A',
      }),
      params: { id: attemptId },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(studentA.cookie, {}),
      params: { id: attemptId },
    })

    const evaluationResponse = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parentA.cookie, { attempt_id: attemptId }),
    })
    const evaluation = await evaluationResponse.json()
    evaluationId = evaluation.evaluation.id
    evaluationItemId = evaluation.items[0].id
  })

  afterAll(async () => {
    // FK-restrict on paper_questions/attempts blocks a straight cascade from households, unlike
    // the simpler papers-only fixture in the earlier version of this test — delete in dependency
    // order instead.
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', '=', evaluationId)
      .execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', '=', attemptId)
      .execute()
    await db.deleteFrom('attempts').where('id', '=', attemptId).execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', '=', paperId)
      .execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'f096-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('GET /api/students never lists another household’s student', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'GET',
    )({ request: request(parentB.cookie) })
    const list = (await response.json()) as Array<{ id: string }>
    expect(list.some((s) => s.id === studentAId)).toBe(false)
  })

  it('PATCH /api/students/:id on another household’s student -> 404', async () => {
    const response = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parentB.cookie, { section: 'Z' }),
      params: { id: studentAId },
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/students/:id/login for another household’s student -> 404', async () => {
    const response = await handlerFor(
      StudentLoginRoute,
      'POST',
    )({
      request: request(parentB.cookie, {
        email: `f096-login-attempt-${Date.now()}@example.com`,
        password: 'correcthorsebatterystaple',
      }),
      params: { id: studentAId },
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/papers/generate for another household’s student -> 404', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parentB.cookie, {
        student_id: studentAId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    expect(response.status).toBe(404)
  })

  it('GET /api/papers/:id for another household’s paper -> 404', async () => {
    const response = await handlerFor(
      PaperByIdRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { id: paperId },
    })
    expect(response.status).toBe(404)
  })

  it('GET /api/tracker/:studentId for another household’s student -> 404', async () => {
    const response = await handlerFor(
      TrackerRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { studentId: studentAId },
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/attempts for another student’s paper -> 404', async () => {
    const response = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(studentB.cookie, { paper_id: paperId, mode: 'online' }),
    })
    expect(response.status).toBe(404)
  })

  it('PATCH /api/attempts/:id/answer on another student’s attempt -> 404', async () => {
    const response = await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(studentB.cookie, {
        paper_question_id: paperQuestionId,
        selected_option: 'B',
      }),
      params: { id: attemptId },
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/attempts/:id/submit on another student’s attempt -> 404', async () => {
    const response = await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(studentB.cookie, {}),
      params: { id: attemptId },
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/evaluations for another household’s attempt -> 404', async () => {
    const response = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parentB.cookie, { attempt_id: attemptId }),
    })
    expect(response.status).toBe(404)
  })

  it('PATCH /api/evaluations/:id/items/:itemId for another household -> 404', async () => {
    const response = await handlerFor(
      EvaluationItemRoute,
      'PATCH',
    )({
      request: request(parentB.cookie, {
        marks: 0,
        feedback: 'should not apply',
      }),
      params: { id: evaluationId, itemId: evaluationItemId },
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/evaluations/:id/confirm for another household -> 404', async () => {
    const response = await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parentB.cookie, {}),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(404)
  })

  it('the owning household can still do all of the above (isolation is not just failing everything)', async () => {
    const paperResponse = await handlerFor(
      PaperByIdRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: paperId },
    })
    expect(paperResponse.status).toBe(200)

    const trackerResponse = await handlerFor(
      TrackerRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { studentId: studentAId },
    })
    expect(trackerResponse.status).toBe(200)

    const confirmResponse = await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parentA.cookie, {}),
      params: { id: evaluationId },
    })
    expect(confirmResponse.status).toBe(200)
  })

  it('GET /api/evaluations/:id/report for another household -> 404, even once confirmed', async () => {
    const response = await handlerFor(
      EvaluationReportRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(404)
  })

  it('the owning household can read the confirmed report', async () => {
    const response = await handlerFor(
      EvaluationReportRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(200)
  })

  it('POST /api/papers/:id/regenerate-slot for another household’s paper -> 404', async () => {
    const response = await handlerFor(
      RegenerateSlotRoute,
      'POST',
    )({
      request: request(parentB.cookie, { paper_question_id: paperQuestionId }),
      params: { id: paperId },
    })
    expect(response.status).toBe(404)
  })

  it('the owning household can regenerate a slot on their own paper', async () => {
    // Paper generation picks randomly between the two same-shape fixture questions, so the slot
    // could have started on either one -- assert the swap actually changed it, not a specific
    // fixed text.
    const before = await db
      .selectFrom('paper_questions')
      .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
      .select('questions.text')
      .where('paper_questions.id', '=', paperQuestionId)
      .executeTakeFirstOrThrow()

    const response = await handlerFor(
      RegenerateSlotRoute,
      'POST',
    )({
      request: request(parentA.cookie, { paper_question_id: paperQuestionId }),
      params: { id: paperId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect([
      'F096 fixture question',
      'F096 fixture question (alternate)',
    ]).toContain(body.question.text)
    expect(body.question.text).not.toBe(before.text)
  })

  it('T01: an unauthenticated request is rejected before any data is touched', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'GET',
    )({
      request: new Request('http://localhost/test'),
    })
    expect(response.status).toBe(401)
  })
})
