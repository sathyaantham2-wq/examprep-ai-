import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as NudgeTodayRoute } from './api/nudges/today'
import { Route as NudgeByIdRoute } from './api/nudges/$id'
import { Route as CronDailyNudgeRoute } from './api/cron/daily-nudge'

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
 * F082: "A single concrete action derived from the latest diagnosis, delivered once daily,
 * marked done or skipped." Real routes, real DB. No fixture concept is needed -- a brand-new
 * student with no concept_status rows exercises the "no action" fallback, which is enough to
 * prove the routes and auth wiring; generateOrGetTodayNudge's own concept-ranking behavior is
 * covered in daily-nudge.test.ts.
 */
describe('daily nudge routes (F082)', () => {
  let db: Db
  let parent: TestSession
  let otherParent: TestSession
  let studentId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('f082-parent')
    otherParent = await createParentSession('f082-other-parent')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'F082 Route Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
  })

  afterAll(async () => {
    await db.deleteFrom('daily_nudges').where('student_id', '=', studentId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parent.householdId, otherParent.householdId])
      .execute()
    await db.destroy()
  })

  it('GET today generates a nudge for the parent', async () => {
    const response = await handlerFor(
      NudgeTodayRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?student_id=${studentId}`, {
        headers: { cookie: parent.cookie },
      }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.nudge.status).toBe('pending')
    expect(typeof body.nudge.action_text).toBe('string')
  })

  it("a different household can't reach this student's nudge", async () => {
    const response = await handlerFor(
      NudgeTodayRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?student_id=${studentId}`, {
        headers: { cookie: otherParent.cookie },
      }),
    })
    expect(response.status).toBe(404)
  })

  it('PATCH marks the nudge done, and GET today reflects it', async () => {
    const current = await handlerFor(
      NudgeTodayRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?student_id=${studentId}`, {
        headers: { cookie: parent.cookie },
      }),
    })
    const nudgeId = (await current.json()).nudge.id

    const patchResponse = await handlerFor(
      NudgeByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, { student_id: studentId, status: 'done' }),
      params: { id: nudgeId },
    })
    expect(patchResponse.status).toBe(200)
    expect((await patchResponse.json()).nudge.status).toBe('done')

    const after = await handlerFor(
      NudgeTodayRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?student_id=${studentId}`, {
        headers: { cookie: parent.cookie },
      }),
    })
    expect((await after.json()).nudge.status).toBe('done')
  })

  it('the daily-nudge cron route refuses to run without CRON_SECRET configured', async () => {
    // Same documented-default as the weekly-summary cron: unset in this dev/test environment,
    // and the route refuses outright rather than ever running unauthenticated.
    const response = await handlerFor(
      CronDailyNudgeRoute,
      'GET',
    )({ request: new Request('http://localhost/test') })
    expect(response.status).toBe(500)
  })
})
