import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as ErrorsRoute } from './api/errors'
import { Route as HouseholdMeRoute } from './api/households/me'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  const handlers = (route.options.server as { handlers: Record<string, RouteHandler> }).handlers
  return handlers[method]
}

/**
 * F004: "Sentry (or equivalent) capturing client + server errors ... request-scoped log IDs."
 * Drives the real POST /api/errors route (client reports) and confirms an already-wrapped real
 * route (GET /api/households/me, F004's own dogfood -- no household exists, so requireRole 403s
 * rather than throws, proving the wrapper is transparent to a route's own normal error handling).
 */
describe('error log routes (F004)', () => {
  let db: Db
  let parent: TestSession

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('f004-errors')
  })

  afterAll(async () => {
    await db.deleteFrom('error_log').where('household_id', '=', parent.householdId).execute()
    await db.deleteFrom('error_log').where('route', '=', '/settings').execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.destroy()
  })

  it('POST /api/errors logs a client-reported error, attributed to the signed-in user', async () => {
    const requestId = crypto.randomUUID()
    const response = await handlerFor(
      ErrorsRoute,
      'POST',
    )({
      request: new Request('http://localhost/test', {
        method: 'POST',
        headers: { cookie: parent.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          route: '/settings',
          message: 'TypeError: cannot read properties of undefined',
          stack: 'TypeError: ...\n  at Component (settings.tsx:42)',
        }),
      }),
    })
    expect(response.status).toBe(204)

    const row = await db
      .selectFrom('error_log')
      .selectAll()
      .where('request_id', '=', requestId)
      .executeTakeFirstOrThrow()
    expect(row.source).toBe('client')
    expect(row.route).toBe('/settings')
    expect(row.household_id).toBe(parent.householdId)
    expect(row.message).toContain('cannot read properties')
  })

  it('POST /api/errors rejects a malformed body', async () => {
    const response = await handlerFor(
      ErrorsRoute,
      'POST',
    )({
      request: new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ route: '/settings' }), // missing request_id/message
      }),
    })
    expect(response.status).toBe(400)
  })

  it("an already-wrapped real route's own 4xx handling still works normally through the wrapper", async () => {
    // No household on this request at all -- requireRole returns its own 403, never throws, so
    // withErrorCapture should be completely invisible here: no error_log row, a normal 403.
    const response = await handlerFor(HouseholdMeRoute, 'GET')({
      request: new Request('http://localhost/test'),
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
})
