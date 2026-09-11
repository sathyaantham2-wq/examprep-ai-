import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentByIdRoute } from './api/students/$id'
import { Route as StudentDashboardRoute } from './api/student-dashboard'

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
    method: body ? 'PATCH' : 'GET',
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F010: "Toggle per student; disabled student sees a friendly locked screen; parent always
 * retains access." Exercises the toggle through the real PATCH /api/students/:id endpoint and
 * checks enforcement through one representative student-facing route (GET /api/student-dashboard)
 * -- the same resolveEnabledStudent() call every other student route in src/lib/access.ts shares,
 * so this one route stands in for all of them rather than re-testing the identical check eleven
 * times.
 */
describe('per-student access toggle (F010)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentA: TestSession
  let studentAId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('access-toggle-a')
    parentB = await createParentSession('access-toggle-b')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'Access Toggle Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentResponse.json()).id
    studentA = await createStudentSession(
      'access-toggle-student',
      parentA.householdId,
      studentAId,
    )
  })

  afterAll(async () => {
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.destroy()
  })

  it('a new student defaults to access_enabled and can reach their own dashboard', async () => {
    const response = await handlerFor(
      StudentDashboardRoute,
      'GET',
    )({ request: request(studentA.cookie) })
    expect(response.status).toBe(200)
  })

  it("another household can't toggle this student's access", async () => {
    const response = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parentB.cookie, { access_enabled: false }),
      params: { id: studentAId },
    })
    expect(response.status).toBe(404)
  })

  it('the owning parent disables the student', async () => {
    const response = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parentA.cookie, { access_enabled: false }),
      params: { id: studentAId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.access_enabled).toBe(false)
  })

  it('the disabled student is locked out of their own dashboard (423), not a generic error', async () => {
    const response = await handlerFor(
      StudentDashboardRoute,
      'GET',
    )({ request: request(studentA.cookie) })
    expect(response.status).toBe(423)
    const body = await response.json()
    expect(body.error).toBe('locked')
  })

  it('the parent retains full access while the student is disabled', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'GET',
    )({ request: request(parentA.cookie) })
    expect(response.status).toBe(200)
    const students = await response.json()
    const student = students.find((s: { id: string }) => s.id === studentAId)
    expect(student.access_enabled).toBe(false)
  })

  it('re-enabling restores the student’s access', async () => {
    await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parentA.cookie, { access_enabled: true }),
      params: { id: studentAId },
    })

    const response = await handlerFor(
      StudentDashboardRoute,
      'GET',
    )({ request: request(studentA.cookie) })
    expect(response.status).toBe(200)
  })
})
