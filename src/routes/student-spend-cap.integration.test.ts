import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { STUDENT_DAILY_GENERATION_COST_CAP_INR } from '../lib/ai-metering'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentByIdRoute } from './api/students/$id'
import { Route as GenerateRoute } from './api/papers/generate'

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
 * F121: "Daily and monthly caps per student on paper generation and evaluation; friendly message
 * on limit; parent can raise the cap." Seeds ai_jobs.cost_inr directly (ANTHROPIC_API_KEY isn't
 * configured in this dev environment, so no real call ever spends anything) to push this student
 * over their default daily cap, drives the real generate route to prove the 429, then drives the
 * real PATCH /api/students/:id route to prove a parent's raised override actually unblocks it --
 * independent of and in addition to F112's separate raw call-count quota.
 */
describe('student daily/monthly AI spend cap (F121)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string
  let questionId: string
  const paperIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('spendcap')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Spend Cap Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession('spendcap-student', parent.householdId, studentId)

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
      code: `C7M-1.SPENDCAP-${Date.now()}`,
      name: 'Spend cap fixture concept',
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
      text: 'Spend cap fixture question',
      answer: '1',
      created_by: 'spendcap-fixture',
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
      name: 'Spend cap fixture blueprint',
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

    // Push this student's today's spend to exactly the default daily cap -- before any real
    // generation call, proving the cap is enforced independent of F112's call-count quota.
    await db
      .insertInto('ai_jobs')
      .values({
        household_id: parent.householdId,
        student_id: studentId,
        feature: 'AI-01',
        model: 'claude-sonnet-5',
        status: 'success',
        latency_ms: 1,
        cost_inr: STUDENT_DAILY_GENERATION_COST_CAP_INR,
      })
      .execute()
  })

  afterAll(async () => {
    if (paperIds.length > 0) {
      await db.deleteFrom('paper_questions').where('paper_id', 'in', paperIds).execute()
    }
    await db.deleteFrom('generation_events').where('student_id', '=', studentId).execute()
    await db.deleteFrom('papers').where('student_id', '=', studentId).execute()
    await db.deleteFrom('ai_jobs').where('student_id', '=', studentId).execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('a student already at their daily spend cap is refused with a friendly 429, even under F112s call quota', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(student.cookie, {
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body.error).toBe('spend_cap_exceeded')
    expect(body.message).toMatch(/spend limit/i)
  })

  it("a parent raising this student's cap unblocks generation again", async () => {
    const patchResponse = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, {
        generation_daily_cap_inr: STUDENT_DAILY_GENERATION_COST_CAP_INR * 10,
      }),
      params: { id: studentId },
    })
    expect(patchResponse.status).toBe(200)
    const patched = await patchResponse.json()
    expect(Number(patched.generation_daily_cap_inr)).toBe(STUDENT_DAILY_GENERATION_COST_CAP_INR * 10)

    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(student.cookie, {
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    paperIds.push(body.paper.id)
  })

  it('a parent can clear the override back to the default with an explicit null', async () => {
    const response = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, { generation_daily_cap_inr: null }),
      params: { id: studentId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.generation_daily_cap_inr).toBeNull()
  })
})
