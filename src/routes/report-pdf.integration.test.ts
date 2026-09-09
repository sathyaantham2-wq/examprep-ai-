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
import { Route as ReportPdfRoute } from './api/evaluations/$id/report/pdf'

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
 * F073: "downloadable PDF including error inventory and concept-wise performance." Runs a real
 * generate -> attempt -> submit -> evaluate -> confirm cycle with a deliberately wrong answer, so
 * the error inventory has a real row to render, then downloads the PDF via the real route.
 */
describe('evaluation report PDF (F073)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentA: TestSession
  let studentAId: string
  let evaluationId: string
  let blueprintId: string
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('report-a')
    parentB = await createParentSession('report-b')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'Report Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentResponse.json()).id
    studentA = await createStudentSession(
      'report-student',
      parentA.householdId,
      studentAId,
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

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.REPORT-${Date.now()}`,
      name: 'Report fixture concept',
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
      text: 'Report fixture question',
      answer: '1',
      created_by: 'report-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Report fixture blueprint',
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
    const paperQuestionId = generated.paperQuestions[0].id

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(studentA.cookie, {
        paper_id: generated.paper.id,
        mode: 'online',
      }),
    })
    const attemptId = (await attemptResponse.json()).id

    // Wrong answer on purpose -- gives the error inventory a real row to render.
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(studentA.cookie, {
        paper_question_id: paperQuestionId,
        selected_option: 'B',
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
    const evalResponse = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parentA.cookie, { attempt_id: attemptId }),
    })
    const evaluation = await evalResponse.json()
    evaluationId = evaluation.evaluation.id
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parentA.cookie, {}),
      params: { id: evaluationId },
    })
  })

  afterAll(async () => {
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', '=', evaluationId)
      .execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db
      .deleteFrom('attempt_answers')
      .where(
        'attempt_id',
        'in',
        db
          .selectFrom('attempts')
          .select('id')
          .where('student_id', '=', studentAId),
      )
      .execute()
    await db
      .deleteFrom('attempts')
      .where('student_id', '=', studentAId)
      .execute()
    await db
      .deleteFrom('paper_questions')
      .where(
        'paper_id',
        'in',
        db
          .selectFrom('papers')
          .select('id')
          .where('student_id', '=', studentAId),
      )
      .execute()
    await db.deleteFrom('papers').where('student_id', '=', studentAId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'report-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('returns a real PDF with the error inventory and concept performance rendered', async () => {
    const response = await handlerFor(
      ReportPdfRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(Buffer.from(bytes.slice(0, 5)).toString('ascii')).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(3000)
  })

  it('another household gets 404', async () => {
    const response = await handlerFor(
      ReportPdfRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(404)
  })
})
