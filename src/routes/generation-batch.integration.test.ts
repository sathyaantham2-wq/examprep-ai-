import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as GenerateBatchRoute } from './api/questions/generate-batch'
import { Route as BatchStatusRoute } from './api/questions/generate-batch/$id'
import { Route as BatchResumeRoute } from './api/questions/generate-batch/$id/resume'

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
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      cookie,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * F116: no ANTHROPIC_API_KEY is configured in this environment (same as F025/F045), so
 * planBatch() always short-circuits at its ai_not_configured check before touching the coverage
 * grid or creating any batch row -- the deterministic parts (chunk sizing, cost math) have their
 * own coverage in ai-question-generation.test.ts (estimateCostInr).
 */
describe('AI bulk question generation batches (F116)', () => {
  let db: Db
  let admin: TestSession
  let plainParent: TestSession
  let subjectId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('batch-gen-admin')
    await promoteToAdmin(admin.userId)
    plainParent = await createParentSession('batch-gen-plain-parent')

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id
  })

  afterAll(async () => {
    await db.deleteFrom('households').where('id', '=', admin.householdId).execute()
    await db
      .deleteFrom('households')
      .where('id', '=', plainParent.householdId)
      .execute()
    await db.destroy()
  })

  it('rejects an unauthenticated request', async () => {
    const response = await handlerFor(
      GenerateBatchRoute,
      'POST',
    )({ request: request('', { subject_id: subjectId, cost_cap_inr: 50 }) })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin (parent) request', async () => {
    const response = await handlerFor(
      GenerateBatchRoute,
      'POST',
    )({
      request: request(plainParent.cookie, {
        subject_id: subjectId,
        cost_cap_inr: 50,
      }),
    })
    expect(response.status).toBe(403)
  })

  it('falls back with batch:null when no AI provider is configured', async () => {
    const response = await handlerFor(
      GenerateBatchRoute,
      'POST',
    )({
      request: request(admin.cookie, { subject_id: subjectId, cost_cap_inr: 50 }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.batch).toBeNull()
    expect(body.message).toMatch(/No AI provider/)
  })

  it('returns 404 for an unknown batch id on the status route', async () => {
    const response = await handlerFor(
      BatchStatusRoute,
      'GET',
    )({
      request: request(admin.cookie),
      params: { id: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.status).toBe(404)
  })

  it('returns 404 for an unknown batch id on the resume route', async () => {
    const response = await handlerFor(
      BatchResumeRoute,
      'POST',
    )({
      request: request(admin.cookie, {}),
      params: { id: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.status).toBe(404)
  })
})
