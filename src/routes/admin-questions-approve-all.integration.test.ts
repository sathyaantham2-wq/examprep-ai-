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

function request(cookie: string, method: 'GET' | 'POST' = 'POST', body?: unknown): Request {
  return new Request('http://localhost/test', {
    method,
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F084: bulk-approving the review queue one question at a time doesn't scale once a generation
 * batch produces more than a couple of items. By default only Tier A (objective, <=2 marks, no
 * diagram) is fast-tracked, since that tier is explicitly designed to "auto-approve with a 10%
 * sample check" (examprep-question-generation skill). Passing include_tier_b:true opts into
 * approving subjective content too, in one request -- the admin explicitly asked for this rather
 * than clicking through each Tier B item one at a time -- but a review_note is still written to
 * every Tier B row (a default one if none is given), so there's still an audit trail of who
 * signed off in bulk and when, same as the existing single-question approve route enforces.
 */
describe('bulk-approve draft questions (F084)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let conceptId: string
  const questionIds: Array<string> = []

  async function makeDraft(overrides: {
    marks: number
    type: 'mcq' | 'long_answer'
    text: string
  }) {
    const q = await createQuestion(db, {
      concept_id: conceptId,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: overrides.marks,
      type: overrides.type,
      text: overrides.text,
      answer: 'answer',
      created_by: 'approve-all-fixture',
      origin: 'ai_generated',
      options:
        overrides.type === 'mcq'
          ? [{ label: 'A', text: 'answer', is_correct: true, order_index: 1 }]
          : undefined,
    })
    questionIds.push(q.id)
    return q.id
  }

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
  })

  afterAll(async () => {
    await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
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

  it('by default approves only draft Tier A questions and leaves Tier B alone', async () => {
    const tierAId = await makeDraft({
      marks: 1,
      type: 'mcq',
      text: 'Approve-all fixture Tier A question 1',
    })
    const tierBId = await makeDraft({
      marks: 3,
      type: 'long_answer',
      text: 'Approve-all fixture Tier B question 1',
    })

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

  it('with include_tier_b approves Tier B too and records a review note', async () => {
    const tierBId = await makeDraft({
      marks: 3,
      type: 'long_answer',
      text: 'Approve-all fixture Tier B question 2',
    })

    const response = await handlerFor(ApproveAllRoute, 'POST')({
      request: request(admin.cookie, 'POST', { include_tier_b: true }),
    })
    expect(response.status).toBe(200)
    const body: { approved: number; skipped_tier_b: number } =
      await response.json()
    expect(body.skipped_tier_b).toBe(0)

    const tierBAfter = await handlerFor(
      QuestionByIdRoute,
      'GET',
    )({ request: request(admin.cookie, 'GET'), params: { id: tierBId } })
    const updated = await tierBAfter.json()
    expect(updated.status).toBe('approved')
    expect(updated.review_note).toBeTruthy()
  })
})
