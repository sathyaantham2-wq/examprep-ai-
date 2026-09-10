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
import { Route as DashboardRoute } from './api/dashboard/$studentId'

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
 * F071: "per subject: latest score, trend, Delivery Gap, top 3 priority concepts, next action,
 * pending uploads." Runs a real paper through generate -> attempt -> submit -> evaluate ->
 * confirm twice (a weak first attempt, then a stronger second one) so trend has something real
 * to compare, then checks the dashboard reflects it -- against the real dev DB.
 */
describe('parent dashboard (F071)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let paperId1: string
  let paperId2: string
  let blueprintId: string
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('dash')

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
      'dash-student',
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
      code: `C7M-1.DASH-${Date.now()}`,
      name: 'Dashboard fixture concept',
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
      text: 'Dashboard fixture question A',
      answer: '1',
      created_by: 'dash-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Dashboard fixture question B',
      answer: '1',
      created_by: 'dash-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Dashboard fixture blueprint',
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

    // Paper 1: answered wrong (selected_option B, correct is A) -> a low first score.
    const generate1 = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      }),
    })
    const generated1 = await generate1.json()
    paperId1 = generated1.paper.id
    const paperQuestionId1 = generated1.paperQuestions[0].id

    const attempt1 = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, { paper_id: paperId1, mode: 'online' }),
    })
    const attemptId1 = (await attempt1.json()).id
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: paperQuestionId1,
        selected_option: 'B',
      }),
      params: { id: attemptId1 },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: attemptId1 },
    })
    const eval1 = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parent.cookie, { attempt_id: attemptId1 }),
    })
    const evaluation1 = await eval1.json()
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: evaluation1.evaluation.id },
    })

    // Paper 2: answered correctly -> an improved second score, so trend has something to show.
    const generate2 = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      }),
    })
    const generated2 = await generate2.json()
    paperId2 = generated2.paper.id
    const paperQuestionId2 = generated2.paperQuestions[0].id

    const attempt2 = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, { paper_id: paperId2, mode: 'online' }),
    })
    const attemptId2 = (await attempt2.json()).id
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: paperQuestionId2,
        selected_option: 'A',
      }),
      params: { id: attemptId2 },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: attemptId2 },
    })
    const eval2 = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parent.cookie, { attempt_id: attemptId2 }),
    })
    const evaluation2 = await eval2.json()
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: evaluation2.evaluation.id },
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
          .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
          .select('evaluations.id')
          .where('attempts.student_id', '=', studentId),
      )
      .execute()
    await db
      .deleteFrom('evaluations')
      .where(
        'attempt_id',
        'in',
        db
          .selectFrom('attempts')
          .select('id')
          .where('student_id', '=', studentId),
      )
      .execute()
    await db
      .deleteFrom('attempt_answers')
      .where(
        'attempt_id',
        'in',
        db
          .selectFrom('attempts')
          .select('id')
          .where('student_id', '=', studentId),
      )
      .execute()
    await db
      .deleteFrom('attempts')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', 'in', [paperId1, paperId2])
      .execute()
    await db
      .deleteFrom('papers')
      .where('id', 'in', [paperId1, paperId2])
      .execute()
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'dash-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('shows the subject card with an improving trend after a second, better attempt', async () => {
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { studentId },
    })
    expect(response.status).toBe(200)
    const dashboard = await response.json()
    expect(dashboard.subjects).toHaveLength(1)

    const card = dashboard.subjects[0]
    expect(card.subject_name).toBe('Mathematics (seed)')
    expect(card.latest_score.percentage).toBe(100)
    expect(card.trend).toBe('up')

    // F075: score-over-time is oldest-first and reflects both real confirmed evaluations.
    expect(card.score_history).toHaveLength(2)
    expect(card.score_history[0].percentage).toBe(0)
    expect(card.score_history[1].percentage).toBe(100)

    expect(dashboard.concept_status_distribution.Strong).toBeGreaterThanOrEqual(1)
  })

  it('another household gets 404', async () => {
    const otherParent = await createParentSession('dash-other')
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({
      request: request(otherParent.cookie),
      params: { studentId },
    })
    expect(response.status).toBe(404)
    await db
      .deleteFrom('households')
      .where('id', '=', otherParent.householdId)
      .execute()
  })
})
