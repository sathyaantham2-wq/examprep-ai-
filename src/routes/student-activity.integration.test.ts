import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { studentsRepository } from '../db/repositories'
import {
  createParentSession,
  createStudentSession,
  promoteToAdmin,
} from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as PingRoute } from './api/activity/ping'
import { Route as AdminActivityRoute } from './api/admin/student-activity'

type RouteHandler = (opts: { request: Request }) => Promise<Response>

function handlerFor(
  route: { options: { server?: unknown } },
  method: string,
): RouteHandler {
  const handlers = (
    route.options.server as { handlers: Record<string, RouteHandler> }
  ).handlers
  return handlers[method]
}

function post(cookie?: string): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  })
}

function get(cookie: string | undefined, query = ''): Request {
  return new Request(`http://localhost/test${query}`, {
    headers: cookie ? { cookie } : {},
  })
}

/**
 * Admin student-activity page (2026-10-03 request): the browser pings while a student is really
 * using the app, the server credits at most the real time since her previous ping, and an admin
 * reads the totals. Only students can ping, only an admin can read.
 */
describe('student activity: pings and the admin report', () => {
  let db: Db
  let parent: TestSession
  let admin: TestSession
  let student: TestSession
  let studentId: string
  const householdIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('activity-parent')
    admin = await createParentSession('activity-admin')
    await promoteToAdmin(admin.userId)
    householdIds.push(parent.householdId, admin.householdId)

    const row = await studentsRepository.insert(db, {
      household_id: parent.householdId,
      name: 'Activity Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    studentId = row.id
    student = await createStudentSession(
      'activity-student',
      parent.householdId,
      studentId,
    )
  })

  afterAll(async () => {
    await db
      .deleteFrom('student_activity_daily')
      .where('student_id', '=', studentId)
      .execute()
    await db.deleteFrom('households').where('id', 'in', householdIds).execute()
    await db.destroy()
  })

  const setRow = (values: { last_seen_at?: Date; active_seconds?: number }) =>
    db
      .updateTable('student_activity_daily')
      .set(values)
      .where('student_id', '=', studentId)
      .execute()

  const rowFor = () =>
    db
      .selectFrom('student_activity_daily')
      .selectAll()
      .where('student_id', '=', studentId)
      .execute()

  it('refuses a signed-out caller, a parent and an admin', async () => {
    expect((await handlerFor(PingRoute, 'POST')({ request: post() })).status).toBe(401)
    expect(
      (await handlerFor(PingRoute, 'POST')({ request: post(parent.cookie) })).status,
    ).toBe(403)
    expect(
      (await handlerFor(PingRoute, 'POST')({ request: post(admin.cookie) })).status,
    ).toBe(403)
    expect(await rowFor()).toHaveLength(0)
  })

  it('credits the first ping of the day one ping interval', async () => {
    const response = await handlerFor(PingRoute, 'POST')({
      request: post(student.cookie),
    })
    expect(response.status).toBe(204)
    const rows = await rowFor()
    expect(rows).toHaveLength(1)
    expect(rows[0].active_seconds).toBe(30)
    expect(rows[0].pings).toBe(1)
  })

  it('never credits more than the real time since the last ping', async () => {
    // Ten rapid pings right after the first: wall clock moved a few seconds at most.
    for (let i = 0; i < 10; i++) {
      await handlerFor(PingRoute, 'POST')({ request: post(student.cookie) })
    }
    const [row] = await rowFor()
    expect(row.pings).toBe(11)
    expect(row.active_seconds).toBeLessThan(30 + 10)
  })

  it('counts a ping 45 s after the previous one as 45 s, and one after a long break as 30 s', async () => {
    await setRow({ last_seen_at: new Date(Date.now() - 45_000), active_seconds: 100 })
    await handlerFor(PingRoute, 'POST')({ request: post(student.cookie) })
    let [row] = await rowFor()
    expect(row.active_seconds).toBe(145)

    await setRow({ last_seen_at: new Date(Date.now() - 2 * 3600_000), active_seconds: 100 })
    await handlerFor(PingRoute, 'POST')({ request: post(student.cookie) })
    ;[row] = await rowFor()
    expect(row.active_seconds).toBe(130)
  })

  it('shows the admin the totals, and keeps the report from students and parents', async () => {
    await setRow({ active_seconds: 600 })

    const denied = await handlerFor(AdminActivityRoute, 'GET')({
      request: get(parent.cookie),
    })
    expect(denied.status).toBe(403)
    expect(
      (await handlerFor(AdminActivityRoute, 'GET')({ request: get(student.cookie) })).status,
    ).toBe(403)

    const response = await handlerFor(AdminActivityRoute, 'GET')({
      request: get(admin.cookie, '?days=7'),
    })
    expect(response.status).toBe(200)
    const report = await response.json()
    expect(report.window_days).toBe(7)
    expect(report.daily).toHaveLength(7)
    expect(report.active_today).toBeGreaterThanOrEqual(1)
    expect(report.total_minutes).toBeGreaterThanOrEqual(10)
    const mine = report.students.find(
      (s: { student_id: string }) => s.student_id === studentId,
    )
    expect(mine).toMatchObject({
      name: 'Activity Kid',
      class: 7,
      minutes_in_window: 10,
      minutes_today: 10,
      active_days: 1,
    })
    expect(report.tracking_since).not.toBeNull()
  })

  it('rejects a window outside 1-180 days', async () => {
    const response = await handlerFor(AdminActivityRoute, 'GET')({
      request: get(admin.cookie, '?days=0'),
    })
    expect(response.status).toBe(400)
  })
})
