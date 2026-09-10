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
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as EvaluationsRoute } from './api/evaluations'
import { Route as EvaluationConfirmRoute } from './api/evaluations/$id/confirm'
import { Route as EvaluationReportRoute } from './api/evaluations/$id/report'
import { Route as HabitsRoute } from './api/evaluations/$id/habits'
import { Route as HabitsTrendRoute } from './api/students/$id/habits/trend'
import { Route as EvaluationByIdRoute } from './api/evaluations/$id'

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
 * F058: "Each habit rated present/partial/absent per paper with a trend line." Runs a real
 * generate -> attempt -> submit -> evaluate cycle, rates two habits before confirming, then
 * checks both that the report reflects the rating and that the trend endpoint surfaces it.
 */
describe('presentation habit tracker (F058)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentA: TestSession
  let studentAId: string
  let evaluationId: string
  let blueprintId: string
  let conceptId: string
  let questionId: string
  let habitH1Id: string
  let habitH8Id: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('habits-a')
    parentB = await createParentSession('habits-b')

    const h1 = await db
      .selectFrom('habits')
      .select('id')
      .where('code', '=', 'H1')
      .executeTakeFirstOrThrow()
    const h8 = await db
      .selectFrom('habits')
      .select('id')
      .where('code', '=', 'H8')
      .executeTakeFirstOrThrow()
    habitH1Id = h1.id
    habitH8Id = h8.id

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'Habits Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentResponse.json()).id
    studentA = await createStudentSession(
      'habits-student',
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
      code: `C7M-1.HABITS-${Date.now()}`,
      name: 'Habits fixture concept',
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
      text: 'Habits fixture question',
      answer: '1',
      created_by: 'habits-fixture',
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
      name: 'Habits fixture blueprint',
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
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(studentA.cookie, { confirm_blanks: true }),
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
  })

  afterAll(async () => {
    await db
      .deleteFrom('habit_observations')
      .where('evaluation_id', '=', evaluationId)
      .execute()
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
    // Scoped to this run's own question id, not a shared created_by literal -- see
    // remediation.integration.test.ts's afterAll for why: the latter also tries to delete any
    // OTHER run's leftover 'habits-fixture' questions, which can still be referenced by that
    // other run's own dangling paper_questions and throw an FK violation here.
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('another household cannot rate habits on this evaluation', async () => {
    const response = await handlerFor(
      HabitsRoute,
      'PATCH',
    )({
      request: request(parentB.cookie, {
        observations: [{ habit_id: habitH1Id, rating: 'present' }],
      }),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(404)
  })

  it('rates two habits before confirming', async () => {
    const response = await handlerFor(
      HabitsRoute,
      'PATCH',
    )({
      request: request(parentA.cookie, {
        observations: [
          { habit_id: habitH1Id, rating: 'present' },
          {
            habit_id: habitH8Id,
            rating: 'absent',
            evidence_note: 'Picked the NOT-true option',
          },
        ],
      }),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(200)
    const observations = await response.json()
    expect(observations).toHaveLength(2)
  })

  it('the review workspace detail (F048) surfaces the full habit library and saved ratings', async () => {
    const response = await handlerFor(
      EvaluationByIdRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(200)
    const detail = await response.json()
    // The full H1-H10 library, not just the two rated so far -- the review screen renders one
    // row per habit regardless of whether it's been rated yet.
    expect(detail.habits.length).toBeGreaterThanOrEqual(10)
    const h1 = detail.habits.find((h: { id: string }) => h.id === habitH1Id)
    const h8 = detail.habits.find((h: { id: string }) => h.id === habitH8Id)
    expect(h1.rating).toBe('present')
    expect(h8.rating).toBe('absent')
    const unrated = detail.habits.find(
      (h: { id: string }) => h.id !== habitH1Id && h.id !== habitH8Id,
    )
    expect(unrated.rating).toBeNull()
  })

  it('the confirmed report includes the recorded habit ratings', async () => {
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parentA.cookie, {}),
      params: { id: evaluationId },
    })

    const response = await handlerFor(
      EvaluationReportRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(200)
    const report = await response.json()
    expect(report.habit_status).toEqual(
      expect.arrayContaining([
        { habit_code: 'H1', habit_name: 'Shows Working', rating: 'present' },
        {
          habit_code: 'H8',
          habit_name: 'Catches Reversal Words',
          rating: 'absent',
        },
      ]),
    )
  })

  it('habits can no longer be edited once confirmed', async () => {
    const response = await handlerFor(
      HabitsRoute,
      'PATCH',
    )({
      request: request(parentA.cookie, {
        observations: [{ habit_id: habitH1Id, rating: 'partial' }],
      }),
      params: { id: evaluationId },
    })
    expect(response.status).toBe(409)
  })

  it('the trend endpoint reports both rated habits for this student', async () => {
    const response = await handlerFor(
      HabitsTrendRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: studentAId },
    })
    expect(response.status).toBe(200)
    const trend: Array<{
      habit_code: string
      observations: Array<{ rating: string }>
    }> = await response.json()

    const h1 = trend.find((t) => t.habit_code === 'H1')
    const h8 = trend.find((t) => t.habit_code === 'H8')
    expect(h1?.observations).toEqual([
      { rating: 'present', confirmed_at: expect.any(String) },
    ])
    expect(h8?.observations).toEqual([
      { rating: 'absent', confirmed_at: expect.any(String) },
    ])
  })

  it('another household gets 404 on the trend endpoint', async () => {
    const response = await handlerFor(
      HabitsTrendRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { id: studentAId },
    })
    expect(response.status).toBe(404)
  })
})
