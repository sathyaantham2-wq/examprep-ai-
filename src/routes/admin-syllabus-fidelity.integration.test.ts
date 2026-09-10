import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as FidelityRoute } from './api/admin/syllabus-fidelity'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  const handlers = (route.options.server as { handlers: Record<string, RouteHandler> }).handlers
  return handlers[method]
}

function request(cookie: string): Request {
  return new Request('http://localhost/test', { headers: { cookie } })
}

describe('syllabus fidelity report (F106)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('fidelity-report-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('fidelity-report-parent')
  })

  afterAll(async () => {
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.destroy()
  })

  it('requires admin', async () => {
    const response = await handlerFor(FidelityRoute, 'GET')({ request: request(parent.cookie) })
    expect(response.status).toBe(403)
  })

  it('reports the violation count and list', async () => {
    const response = await handlerFor(FidelityRoute, 'GET')({ request: request(admin.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.count).toBe(body.violations.length)
    expect(typeof body.count).toBe('number')
  })
})
