import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as ApproveAllRoute } from './api/questions/approve-all'
import { Route as QuestionByIdRoute } from './api/questions/$id'

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

function request(cookie: string, method: 'GET' | 'POST' = 'POST'): Request {
  return new Request('http://localhost/test', {
    method,
    headers: { cookie },
  })
}

/**
 * F084: bulk-approving the review queue one question at a time doesn't scale once a generation
 * batch produces more than a couple of items -- but only Tier A (objective, <=2 marks, no
 * diagram) is safe to fast-track, since that tier is explicitly designed to "auto-approve with a
 * 10% sample check" (examprep-question-generation skill). Tier B keeps requiring
 * POST /api/questions/:id/approve with a reviewer note one at a time.
 */
describe('bulk-approve Tier A draft questions (F084)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let conceptId: string
  let tierAId: string
  let tierBId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('approve-all-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('approve-all-parent')

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
      code: `C7M-1.APPROVEALL-${Date.now()}`,
      name: 'Approve-all fixture concept',
      difficulty_base: 'Easy',
      target_question_count: 18,
    })
    conceptId = concept.id

    // origin: 'ai_generated' so both land as draft regardless of tier, matching how the
    // question-generation flow actually produces them (F025).
    const tierA = await createQuestion(db, {
      concept_id: conceptId,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Approve-all fixture Tier A question',
      answer: 'A',
      created_by: 'approve-all-fixture',
      origin: 'ai_generated',
      options: [{ label: 'A', text: '1', is_correct: true, order_index: 1 }],
    })
    tierAId = tierA.id

    const tierB = await createQuestion(db, {
      concept_id: conceptId,
      board: 'CBSE',
      class: 7,
      bloom: 'Create',
      difficulty: 'Hard',
      marks: 3,
      type: 'long_answer',
      text: 'Approve-all fixture Tier B question',
      answer: 'Some long answer',
      created_by: 'approve-all-fixture',
      origin: 'ai_generated',
    })
    tierBId = tierB.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('questions')
      .where('id', 'in', [tierAId, tierBId])
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.destroy()
  })

  it('rejects an unauthenticated request', async () => {
    const response = await handlerFor(ApproveAllRoute, 'POST')({
      request: request(''),
    })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin parent', async () => {
    const response = await handlerFor(ApproveAllRoute, 'POST')({
      request: request(parent.cookie),
    })
    expect(response.status).toBe(403)
  })

  it('approves every draft Tier A question and leaves Tier B alone', async () => {
    const response = await handlerFor(ApproveAllRoute, 'POST')({
      request: request(admin.cookie),
    })
    expect(response.status).toBe(200)
    const body: { approved: number; skipped_tier_b: number } =
      await response.json()
    expect(body.approved).toBeGreaterThanOrEqual(1)
    expect(body.skipped_tier_b).toBeGreaterThanOrEqual(1)

    const tierAAfter = await handlerFor(
      QuestionByIdRoute,
      'GET',
    )({ request: request(admin.cookie, 'GET'), params: { id: tierAId } })
    expect((await tierAAfter.json()).status).toBe('approved')

    const tierBAfter = await handlerFor(
      QuestionByIdRoute,
      'GET',
    )({ request: request(admin.cookie, 'GET'), params: { id: tierBId } })
    expect((await tierBAfter.json()).status).toBe('draft')
  })
})
