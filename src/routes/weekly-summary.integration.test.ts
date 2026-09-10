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
import { Route as WeeklySummaryRoute } from './api/summary/weekly/$studentId'

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
 * F074: round 1 (wrong answer) is backdated to 8 days ago so it lands in "last week"; round 2
 * (right answer, real "now" timestamp) lands in "this week" -- proving cumulative_stats and
 * most_improved_concept actually compare two real, distinct time windows rather than reading the
 * same data twice.
 */
describe('weekly summary (F074)', () => {
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
    parent = await createParentSession('weekly-summary')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Weekly Summary Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'weekly-summary-student',
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
      code: `C7M-1.WEEKLYSUM-${Date.now()}`,
      name: 'Weekly summary fixture concept',
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
        text: `Weekly summary fixture question ${suffix}`,
        answer: '4',
        created_by: 'weekly-summary-fixture',
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
      name: 'Weekly summary fixture blueprint',
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

    // Backdate round 1 (the wrong answer) into "last week" — 8 days ago — so it and round 2
    // (real "now" timestamps) land in genuinely different comparison windows.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await db
      .updateTable('evaluations')
      .set({ confirmed_at: eightDaysAgo })
      .where('id', '=', evaluationIds[0])
      .execute()
    await db
      .updateTable('concept_mastery')
      .set({ date: eightDaysAgo.toISOString().slice(0, 10) })
      .where('evaluation_id', '=', evaluationIds[0])
      .execute()
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
      .where('created_by', '=', 'weekly-summary-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('rejects an unauthenticated request', async () => {
    const response = await handlerFor(
      WeeklySummaryRoute,
      'GET',
    )({ request: request(''), params: { studentId } })
    expect(response.status).toBe(401)
  })

  it('returns 404 for a student outside the caller\'s household', async () => {
    const response = await handlerFor(
      WeeklySummaryRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { studentId: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.status).toBe(404)
  })

  it('separates this week from last week and finds the improved concept', async () => {
    const response = await handlerFor(
      WeeklySummaryRoute,
      'GET',
    )({ request: request(parent.cookie), params: { studentId } })
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.cumulative_stats.this_week.evaluations_count).toBe(1)
    expect(body.cumulative_stats.this_week.avg_percentage).toBe(100)
    expect(body.cumulative_stats.last_week.evaluations_count).toBe(1)
    expect(body.cumulative_stats.last_week.avg_percentage).toBe(0)

    expect(body.most_improved_concept).not.toBeNull()
    expect(body.most_improved_concept.concept_id).toBe(conceptId)
    expect(body.most_improved_concept.delta).toBe(100)

    expect(body.best_subject).not.toBeNull()
    expect(body.best_subject.avg_percentage).toBe(100)
  })
})
