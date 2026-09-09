import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  blueprintsRepository,
  householdsRepository,
  studentsRepository,
  attemptsRepository,
  attemptAnswersRepository,
} from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { generatePaper } from '../lib/papers'
import { createEvaluation, confirmEvaluation } from '../lib/evaluation'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StatsRoute } from './api/questions/$id/stats'
import { Route as QuestionByIdRoute } from './api/questions/$id'

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
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F118: "live stats ... anomalous items are auto-flagged ... can be retired without deleting
 * historical results." Five students all answer the same "Easy" question wrong -- a real,
 * live-computed 0% success rate on an Easy item, which is exactly what the anomaly rule flags.
 *
 * The 5 generate/attempt/evaluate cycles are built directly against generatePaper()/
 * createEvaluation()/confirmEvaluation() and the repository layer (same pattern
 * papers.integration.test.ts and household-isolation.integration.test.ts already use) rather
 * than through 5 full real auth signups -- this test is about the stats computation, not about
 * exercising auth/session plumbing five times over, and the real routes ARE still used for the
 * two things actually under test: the stats endpoint and the retire endpoint.
 */
describe('question stats and retirement (F118)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let questionId: string
  let conceptId: string
  let blueprintId: string
  const evaluationIds: Array<string> = []
  const attemptIds: Array<string> = []
  const paperIds: Array<string> = []
  const studentIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('stats-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('stats-parent')

    household = await householdsRepository.insert(db, {
      name: 'Stats Fixture Household',
      plan: 'free',
    })

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
      code: `C7M-1.STATS-${Date.now()}`,
      name: 'Stats fixture concept',
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
      text: 'Stats fixture question',
      answer: '1',
      created_by: 'stats-fixture',
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
      name: 'Stats fixture blueprint',
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

    // 5 different students under one household, each answering the same only-eligible question
    // wrong. recentUsageWindowDays exclusion is per-student, so a fresh student each time means
    // no cross-iteration interference despite there being only one eligible question.
    for (let i = 0; i < 5; i++) {
      const student = await studentsRepository.insert(db, {
        household_id: household.id,
        name: `Stats Kid ${i}`,
        class: 7,
        board: 'CBSE',
        target_exams: JSON.stringify([]),
      })
      studentIds.push(student.id)

      const generated = await generatePaper(db, {
        student_id: student.id,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      })
      expect(generated.paperQuestions).toHaveLength(1)
      paperIds.push(generated.paper.id)
      const paperQuestionId = generated.paperQuestions[0].id

      const attempt = await attemptsRepository.insert(db, {
        paper_id: generated.paper.id,
        student_id: student.id,
        mode: 'online',
        status: 'in_progress',
      })
      attemptIds.push(attempt.id)

      await attemptAnswersRepository.upsert(db, {
        attempt_id: attempt.id,
        paper_question_id: paperQuestionId,
        selected_option: 'B', // wrong, every time
        source: 'typed',
      })
      await attemptsRepository.update(db, student.id, attempt.id, {
        status: 'submitted',
        submitted_at: new Date(),
        duration_used_sec: 30,
      })

      const evaluation = await createEvaluation(db, attempt.id)
      evaluationIds.push(evaluation.evaluation.id)
      await confirmEvaluation(db, evaluation.evaluation.id)
    }
  })

  afterAll(async () => {
    await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', evaluationIds).execute()
    await db.deleteFrom('evaluations').where('id', 'in', evaluationIds).execute()
    await db.deleteFrom('attempt_answers').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    await db.deleteFrom('paper_questions').where('paper_id', 'in', paperIds).execute()
    await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [household.id, admin.householdId, parent.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('requires admin', async () => {
    const response = await handlerFor(StatsRoute, 'GET')({
      request: request(parent.cookie),
      params: { id: questionId },
    })
    expect(response.status).toBe(403)
  })

  it('reports a 0% success rate and flags the Easy-question anomaly', async () => {
    const response = await handlerFor(StatsRoute, 'GET')({
      request: request(admin.cookie),
      params: { id: questionId },
    })
    expect(response.status).toBe(200)
    const stats = await response.json()
    expect(stats.attempts).toBe(5)
    expect(stats.success_rate).toBe(0)
    expect(stats.anomaly.flagged).toBe(true)
    expect(stats.anomaly.reasons[0]).toContain('Easy')
  })

  it('retiring the question keeps historical evaluation data intact', async () => {
    const response = await handlerFor(QuestionByIdRoute, 'PATCH')({
      request: request(admin.cookie, { status: 'retired' }),
      params: { id: questionId },
    })
    expect(response.status).toBe(200)
    const updated = await response.json()
    expect(updated.status).toBe('retired')

    const items = await db
      .selectFrom('evaluation_items')
      .innerJoin('paper_questions', 'paper_questions.id', 'evaluation_items.paper_question_id')
      .select('evaluation_items.id')
      .where('paper_questions.question_id', '=', questionId)
      .execute()
    expect(items).toHaveLength(5)
  })
})
