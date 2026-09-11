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
import { Route as HabitsRoute } from './api/evaluations/$id/habits'
import { Route as HabitDrillsRoute } from './api/habit-drills'
import { Route as HabitDrillsGenerateRoute } from './api/habit-drills/generate'
import { Route as HabitDrillByIdRoute } from './api/habit-drills/$id'
import { Route as HabitDrillAttemptRoute } from './api/habit-drills/$id/attempt'

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
 * F070: "short drills targeting a habit ... with pass criteria." Rates H5 ("Attempts Every
 * Question", mapped to the blank-sweep drill kind) absent on two real confirmed evaluations to
 * trip the trigger, then drives the full generate -> attempt loop through the real routes.
 */
describe('habit micro-drills (F070)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentA: TestSession
  let studentAId: string
  let blueprintId: string
  let conceptId: string
  const questionIds: Array<string> = []
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []
  const evaluationIds: Array<string> = []
  let habitH5Id: string
  let habitH8Id: string // used only for the "not triggered" check -- never rated in this fixture

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('habit-drills-a')
    parentB = await createParentSession('habit-drills-b')

    const h5 = await db
      .selectFrom('habits')
      .select('id')
      .where('code', '=', 'H5')
      .executeTakeFirstOrThrow()
    habitH5Id = h5.id
    const h8 = await db
      .selectFrom('habits')
      .select('id')
      .where('code', '=', 'H8')
      .executeTakeFirstOrThrow()
    habitH8Id = h8.id

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'Habit Drill Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentResponse.json()).id
    studentA = await createStudentSession(
      'habit-drill-student',
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
      code: `C7M-1.HABITDRILL-${Date.now()}`,
      name: 'Habit drill fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // Two questions, not one -- paper generation excludes a recently served question from the
    // next round (F026), and this fixture generates two separate papers back to back.
    for (const suffix of ['A', 'B']) {
      const question = await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `Habit drill fixture question ${suffix}`,
        answer: '1',
        created_by: 'habit-drill-fixture',
        options: [
          { label: 'A', text: '1', is_correct: true, order_index: 1 },
          { label: 'B', text: '2', is_correct: false, order_index: 2 },
        ],
      })
      questionIds.push(question.id)
    }

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Habit drill fixture blueprint',
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

    // Two full generate -> attempt -> submit -> evaluate -> rate H5 absent -> confirm rounds --
    // the trigger needs the two most RECENT confirmed ratings, so both must actually be confirmed.
    for (let i = 0; i < 2; i++) {
      const generateResponse = await handlerFor(
        GenerateRoute,
        'POST',
      )({
        request: request(parentA.cookie, {
          student_id: studentAId,
          blueprint_id: blueprintId,
          chapter_ids: [chapter.id],
        }),
      })
      const generated = await generateResponse.json()
      paperIds.push(generated.paper.id)

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
      attemptIds.push(attemptId)
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
      )({ request: request(parentA.cookie, { attempt_id: attemptId }) })
      const evaluation = await evalResponse.json()
      evaluationIds.push(evaluation.evaluation.id)

      await handlerFor(
        HabitsRoute,
        'PATCH',
      )({
        request: request(parentA.cookie, {
          observations: [{ habit_id: habitH5Id, rating: 'absent' }],
        }),
        params: { id: evaluation.evaluation.id },
      })
      await handlerFor(
        EvaluationConfirmRoute,
        'POST',
      )({ request: request(parentA.cookie, {}), params: { id: evaluation.evaluation.id } })
    }
  })

  afterAll(async () => {
    await db
      .deleteFrom('habit_drill_tasks')
      .where('student_id', '=', studentAId)
      .execute()
    await db
      .deleteFrom('habit_observations')
      .where('evaluation_id', 'in', evaluationIds.length > 0 ? evaluationIds : [''])
      .execute()
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', 'in', evaluationIds.length > 0 ? evaluationIds : [''])
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('id', 'in', evaluationIds.length > 0 ? evaluationIds : [''])
      .execute()
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', 'in', attemptIds.length > 0 ? attemptIds : [''])
      .execute()
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    if (paperIds.length > 0) {
      await db
        .deleteFrom('paper_questions')
        .where('paper_id', 'in', paperIds)
        .execute()
      await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    }
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    if (questionIds.length > 0) {
      await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    }
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('refuses to generate a drill for a habit that is not triggered', async () => {
    const response = await handlerFor(
      HabitDrillsGenerateRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        student_id: studentAId,
        habit_id: habitH8Id, // never rated in this fixture
      }),
    })
    expect(response.status).toBe(422)
  })

  let taskId: string

  it('generates a blank-sweep drill once the last two ratings for H5 are both absent', async () => {
    const response = await handlerFor(
      HabitDrillsGenerateRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        student_id: studentAId,
        habit_id: habitH5Id,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.drill_kind).toBe('blank_sweep')
    expect(body.questions).toHaveLength(3)
    taskId = body.task_id
  })

  it('another household cannot read this drill task', async () => {
    const response = await handlerFor(
      HabitDrillByIdRoute,
      'GET',
    )({ request: request(parentB.cookie), params: { id: taskId } })
    expect(response.status).toBe(404)
  })

  it('lists the open drill for this student', async () => {
    const response = await handlerFor(
      HabitDrillsRoute,
      'GET',
    )({ request: request(studentA.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(
      body.tasks.some((t: { id: string; status: string }) => t.id === taskId && t.status === 'pending'),
    ).toBe(true)
  })

  it('passes the blank-sweep drill when every question is answered, regardless of correctness', async () => {
    const detailResponse = await handlerFor(
      HabitDrillByIdRoute,
      'GET',
    )({ request: request(studentA.cookie), params: { id: taskId } })
    const detail = await detailResponse.json()

    const response = await handlerFor(
      HabitDrillAttemptRoute,
      'POST',
    )({
      request: request(studentA.cookie, {
        // Every option is answered "B" -- possibly wrong, but blank_sweep doesn't score
        // correctness, only completeness.
        answers: detail.questions.map((q: { id: string }) => ({
          question_id: q.id,
          selected_option: 'B',
        })),
      }),
      params: { id: taskId },
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toEqual({ ok: true, passed: true })
  })

  it('refuses a second attempt on the same completed task', async () => {
    const response = await handlerFor(
      HabitDrillAttemptRoute,
      'POST',
    )({
      request: request(studentA.cookie, { answers: [] }),
      params: { id: taskId },
    })
    expect(response.status).toBe(409)
  })
})
