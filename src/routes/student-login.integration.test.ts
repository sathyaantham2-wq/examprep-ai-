import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { auth } from '../lib/auth'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentLoginRoute } from './api/students/$id/login'

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
 * No F-number specifies this literally -- it bridges F007 (role model), F008 (household &
 * multi-student profiles) and F010 (parent-controlled student access), none of which say how a
 * student's login is actually created. Before this, the only way a student session ever existed
 * anywhere in this repo was a test fixture inserting users/accounts rows directly
 * (createStudentSession in db/test-helpers.ts) -- a real parent had no path to this at all.
 */
describe('parent creates a student login (bridges F007/F008/F010)', () => {
  let db: Db
  let parent: TestSession
  let studentId: string
  const studentEmail = `student-login-${Date.now()}@example.com`
  let createdUserId: string | undefined

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('login')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Login Test Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
  })

  afterAll(async () => {
    if (createdUserId) {
      await db
        .deleteFrom('sessions')
        .where('user_id', '=', createdUserId)
        .execute()
      await db
        .deleteFrom('accounts')
        .where('user_id', '=', createdUserId)
        .execute()
    }
    await db.deleteFrom('students').where('id', '=', studentId).execute()
    await db
      .deleteFrom('consents')
      .where('household_id', '=', parent.householdId)
      .execute()
    if (createdUserId) {
      await db.deleteFrom('users').where('id', '=', createdUserId).execute()
    }
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.destroy()
  })

  it('creates a working student login that can sign in for real', async () => {
    const response = await handlerFor(
      StudentLoginRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        email: studentEmail,
        password: 'correcthorsebatterystaple',
      }),
      params: { id: studentId },
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.email).toBe(studentEmail)
    expect(body.password).toBeUndefined()
    createdUserId = body.id

    const student = await db
      .selectFrom('students')
      .selectAll()
      .where('id', '=', studentId)
      .executeTakeFirstOrThrow()
    expect(student.user_id).toBe(createdUserId)

    // The real proof: this login must work through better-auth's actual sign-in, not just leave
    // rows sitting in the database.
    const signIn = await auth.api.signInEmail({
      body: { email: studentEmail, password: 'correcthorsebatterystaple' },
    })
    const signedInUser = signIn.user as typeof signIn.user & {
      role: string
      household_id: string
    }
    expect(signedInUser.role).toBe('student')
    expect(signedInUser.household_id).toBe(parent.householdId)
  })

  it('refuses a second login for a student who already has one', async () => {
    const response = await handlerFor(
      StudentLoginRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        email: `second-attempt-${Date.now()}@example.com`,
        password: 'correcthorsebatterystaple',
      }),
      params: { id: studentId },
    })
    expect(response.status).toBe(409)
  })

  it('rejects a duplicate email across students with a clean 409, not a 500', async () => {
    const otherStudentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Second Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    const otherStudentId = (await otherStudentResponse.json()).id

    const response = await handlerFor(
      StudentLoginRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        email: studentEmail,
        password: 'correcthorsebatterystaple',
      }),
      params: { id: otherStudentId },
    })
    expect(response.status).toBe(409)

    await db.deleteFrom('students').where('id', '=', otherStudentId).execute()
  })
})
