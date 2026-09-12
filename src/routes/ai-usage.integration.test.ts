import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { logAiJob } from '../lib/ai-metering'
import { Route as StudentsRoute } from './api/students'
import { Route as AiUsageRoute } from './api/admin/ai-usage'

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
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F091: "Every AI call logs model, tokens in/out, latency, cost and purpose; dashboard by day,
 * feature and student." Seeds ai_jobs rows directly via logAiJob (the same function every
 * AI-*.ts module calls) rather than driving a real Anthropic call, then checks GET
 * /api/admin/ai-usage aggregates them correctly under each grouping and rejects a non-admin.
 */
describe('AI usage & cost dashboard (F091)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let studentId: string
  const today = new Date().toISOString().slice(0, 10)

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('ai-usage-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('ai-usage-parent')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'AI Usage Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id

    await logAiJob(db, {
      feature: 'AI-05',
      model: 'claude-sonnet-5',
      householdId: parent.householdId,
      studentId,
      tokensIn: 1000,
      tokensOut: 500,
      latencyMs: 900,
      status: 'success',
    })
    await logAiJob(db, {
      feature: 'AI-09',
      model: 'claude-sonnet-5',
      householdId: parent.householdId,
      studentId,
      latencyMs: 150,
      status: 'error',
      error: 'boom',
    })
    await logAiJob(db, {
      feature: 'AI-01',
      model: 'claude-sonnet-5',
      householdId: null,
      studentId: null,
      tokensIn: 2000,
      tokensOut: 1000,
      latencyMs: 1200,
      status: 'success',
    })
  })

  afterAll(async () => {
    await db.deleteFrom('ai_jobs').where('household_id', '=', parent.householdId).execute()
    await db
      .deleteFrom('ai_jobs')
      .where('household_id', 'is', null)
      .where('feature', '=', 'AI-01')
      .where('created_at', '>=', new Date(Date.now() - 60_000))
      .execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.destroy()
  })

  it('requires admin', async () => {
    const response = await handlerFor(AiUsageRoute, 'GET')({ request: request(parent.cookie) })
    expect(response.status).toBe(403)
  })

  it('reports overall totals across all three seeded jobs', async () => {
    const response = await handlerFor(AiUsageRoute, 'GET')({ request: request(admin.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.totals.calls).toBeGreaterThanOrEqual(3)
    expect(body.totals.error_count).toBeGreaterThanOrEqual(1)
    expect(body.totals.tokens_in).toBeGreaterThanOrEqual(3000)
  })

  it('groups by feature, one bucket per AI-* id', async () => {
    const response = await handlerFor(
      AiUsageRoute,
      'GET',
    )({ request: new Request('http://localhost/test?group_by=feature', { headers: { cookie: admin.cookie } }) })
    const body = await response.json()
    const byKey = new Map(body.buckets.map((b: { group_key: string; calls: number }) => [b.group_key, b]))
    expect((byKey.get('AI-05') as { calls: number }).calls).toBeGreaterThanOrEqual(1)
    expect((byKey.get('AI-09') as { calls: number }).calls).toBeGreaterThanOrEqual(1)
    expect((byKey.get('AI-01') as { calls: number }).calls).toBeGreaterThanOrEqual(1)
  })

  it('groups by student, attributing AI-01 to no student', async () => {
    const response = await handlerFor(
      AiUsageRoute,
      'GET',
    )({ request: new Request('http://localhost/test?group_by=student', { headers: { cookie: admin.cookie } }) })
    const body = await response.json()
    const studentBucket = body.buckets.find(
      (b: { group_key: string | null }) => b.group_key === studentId,
    )
    expect(studentBucket.calls).toBe(2)
    const noStudentBucket = body.buckets.find(
      (b: { group_key: string | null }) => b.group_key === null,
    )
    expect(noStudentBucket.label).toMatch(/no student/i)
  })

  it('groups by day and includes today', async () => {
    const response = await handlerFor(
      AiUsageRoute,
      'GET',
    )({ request: new Request('http://localhost/test?group_by=day', { headers: { cookie: admin.cookie } }) })
    const body = await response.json()
    const todayBucket = body.buckets.find((b: { group_key: string }) => b.group_key === today)
    expect(todayBucket).toBeTruthy()
    expect(todayBucket.calls).toBeGreaterThanOrEqual(3)
  })
})
