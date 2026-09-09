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
import { Route as EvaluationByIdRoute } from './api/evaluations/$id'
import { Route as EvaluationConfirmRoute } from './api/evaluations/$id/confirm'

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
    method: body !== undefined ? 'POST' : 'GET',
    headers: {
      cookie,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * F048: the evaluation review workspace's data layer. GET /api/evaluations/:id merges evaluation
 * items with question text/options/correct-answer/student-response for the parent to review --
 * unlike the student-facing GET /api/attempts/:id, showing is_correct here is correct, not a T09
 * violation, since only the student role is barred from the answer key.
 *
 * Also covers the idempotency fix to POST /api/evaluations: createEvaluation() never flips
 * attempts.status (only confirmEvaluation() does), so reopening the review screen before
 * confirming used to risk creating a second, orphaned evaluation for the same attempt.
 */
describe('evaluation review workspace data (F048)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let attemptId: string
  let paperId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('evalreview')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Eval Review Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'evalreview-student',
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

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.EVALREVIEW-${Date.now()}`,
      name: 'Eval review fixture concept',
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
      text: 'Which is bigger?',
      answer: 'B',
      created_by: 'evalreview-fixture',
      options: [
        { label: 'A', text: '3', is_correct: false, order_index: 1 },
        { label: 'B', text: '5', is_correct: true, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Eval review fixture blueprint',
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
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      }),
    })
    const generated = await generateResponse.json()
    paperId = generated.paper.id

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, { paper_id: paperId, mode: 'online' }),
    })
    attemptId = (await attemptResponse.json()).id

    const pq = generated.paperQuestions[0]
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: pq.id,
        selected_option: 'A',
      }),
      params: { id: attemptId },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: attemptId },
    })
  })

  afterAll(async () => {
    await db
      .deleteFrom('evaluation_items')
      .where(
        'evaluation_id',
        'in',
        db
          .selectFrom('evaluations')
          .select('id')
          .where('attempt_id', '=', attemptId),
      )
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('attempt_id', '=', attemptId)
      .execute()
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
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'evalreview-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('POST /api/evaluations is idempotent and GET /api/evaluations/:id returns full question context', async () => {
    const first = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({ request: request(parent.cookie, { attempt_id: attemptId }) })
    expect(first.status).toBe(201)
    const firstBody = await first.json()

    const second = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({ request: request(parent.cookie, { attempt_id: attemptId }) })
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.evaluation.id).toBe(firstBody.evaluation.id)

    const detail = await handlerFor(
      EvaluationByIdRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { id: firstBody.evaluation.id },
    })
    expect(detail.status).toBe(200)
    const detailBody = await detail.json()
    expect(detailBody.items).toHaveLength(1)
    const item = detailBody.items[0]
    expect(item.question_text).toBe('Which is bigger?')
    expect(item.correct_answer).toBe('B')
    expect(
      item.options.find((o: { is_correct: boolean }) => o.is_correct).label,
    ).toBe('B')
    expect(item.student_answer).toEqual({
      selected_option: 'A',
      response_text: null,
    })

    // Confirm, then re-POST /api/evaluations one more time -- it must still return the same,
    // now-confirmed evaluation rather than erroring or creating a duplicate.
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: firstBody.evaluation.id },
    })

    const third = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({ request: request(parent.cookie, { attempt_id: attemptId }) })
    expect(third.status).toBe(200)
    const thirdBody = await third.json()
    expect(thirdBody.evaluation.id).toBe(firstBody.evaluation.id)
    expect(thirdBody.evaluation.confirmed_at).not.toBeNull()
  })

  it('another household gets 404 from GET /api/evaluations/:id', async () => {
    const evaluation = await db
      .selectFrom('evaluations')
      .select('id')
      .where('attempt_id', '=', attemptId)
      .executeTakeFirstOrThrow()
    const other = await createParentSession('evalreview-other')
    const response = await handlerFor(
      EvaluationByIdRoute,
      'GET',
    )({
      request: request(other.cookie),
      params: { id: evaluation.id },
    })
    expect(response.status).toBe(404)
    await db
      .deleteFrom('households')
      .where('id', '=', other.householdId)
      .execute()
  })
})
