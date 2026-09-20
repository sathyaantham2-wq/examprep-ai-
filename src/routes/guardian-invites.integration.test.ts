import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { auth } from '../lib/auth'
import { TEST_PASSWORD } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as InvitesRoute } from './api/guardian-invites'
import { Route as IncomingRoute } from './api/guardian-invites/incoming'
import { Route as RespondRoute } from './api/guardian-invites/$id/respond'
import { Route as RevokeRoute } from './api/guardian-invites/$id/revoke'
import { Route as LeaveRoute } from './api/guardian-invites/leave'

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
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

interface Session {
  cookie: string
  userId: string
  email: string
  householdId: string
}

// Signs up through the real better-auth path with the sign-up form's signup_type and signs in
// (there is no email confirmation step).
async function signUpAs(prefix: string, signupType: string): Promise<Session> {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const signUp = await auth.api.signUpEmail({
    body: {
      email,
      password: TEST_PASSWORD,
      name: `${prefix} tester`,
      signup_type: signupType,
    },
  })
  const signIn = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    asResponse: true,
  })
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('no cookie')
  return {
    cookie,
    userId: signUp.user.id,
    email,
    householdId: (signUp.user as { household_id?: string }).household_id!,
  }
}

async function json(response: Response) {
  return response.status === 204 ? null : response.json().catch(() => null)
}

describe('one student, one login: guardians follow students by invite', () => {
  let db: Db
  let student: Session
  let parent: Session
  let teacher: Session
  let stranger: Session
  let tampered: Session
  let studentRowId: string
  const householdIds: Array<string> = []
  const userIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    student = await signUpAs('gi-student', 'student')
    parent = await signUpAs('gi-parent', 'parent')
    teacher = await signUpAs('gi-teacher', 'teacher')
    stranger = await signUpAs('gi-stranger', 'parent')
    tampered = await signUpAs('gi-tampered', 'admin')
    for (const s of [student, parent, teacher, stranger, tampered]) {
      householdIds.push(s.householdId)
      userIds.push(s.userId)
    }
  })

  afterAll(async () => {
    await db.deleteFrom('guardian_invites').where('guardian_household_id', 'in', householdIds).execute()
    await db.deleteFrom('consents').where('student_id', 'in', (qb) =>
      qb.selectFrom('students').select('id').where('user_id', 'in', userIds),
    ).execute()
    await db.deleteFrom('students').where('user_id', 'in', userIds).execute()
    await db.deleteFrom('sessions').where('user_id', 'in', userIds).execute()
    await db.deleteFrom('accounts').where('user_id', 'in', userIds).execute()
    await db.deleteFrom('users').where('id', 'in', userIds).execute()
    await db.deleteFrom('households').where('id', 'in', householdIds).execute()
    await db.destroy()
  })

  it('a student sign-up gets her own profile, consent and household', async () => {
    const row = await db
      .selectFrom('students')
      .selectAll()
      .where('user_id', '=', student.userId)
      .executeTakeFirstOrThrow()
    studentRowId = row.id
    expect(row.class).toBe(7)
    expect(row.board).toBe('CBSE')
    expect(row.household_id).toBe(student.householdId)
    expect(row.own_household_id).toBe(student.householdId)
    const consent = await db
      .selectFrom('consents')
      .selectAll()
      .where('student_id', '=', row.id)
      .executeTakeFirst()
    expect(consent).toBeDefined()
    const user = await db
      .selectFrom('users')
      .select('role')
      .where('id', '=', student.userId)
      .executeTakeFirstOrThrow()
    expect(user.role).toBe('student')
  })

  it('never lets a sign-up choose the admin role', async () => {
    const user = await db
      .selectFrom('users')
      .select('role')
      .where('id', '=', tampered.userId)
      .executeTakeFirstOrThrow()
    expect(user.role).toBe('parent')
  })

  it('a teacher sign-up is a teacher, view-only on students', async () => {
    const list = await handlerFor(StudentsRoute, 'GET')({ request: request(teacher.cookie) })
    expect(list.status).toBe(200)
    const create = await handlerFor(StudentsRoute, 'POST')({
      request: request(teacher.cookie, { name: 'x', class: 7, board: 'CBSE', consent_accepted: true }),
    })
    expect(create.status).toBe(403)
  })

  it('an invite needs the consent box and never reveals whether an account exists', async () => {
    const noConsent = await handlerFor(InvitesRoute, 'POST')({
      request: request(parent.cookie, { student_email: student.email, consent: false }),
    })
    expect(noConsent.status).toBe(400)

    const real = await handlerFor(InvitesRoute, 'POST')({
      request: request(parent.cookie, { student_email: student.email.toUpperCase(), consent: true }),
    })
    const unknown = await handlerFor(InvitesRoute, 'POST')({
      request: request(parent.cookie, {
        student_email: `nobody-${Date.now()}@example.com`,
        consent: true,
      }),
    })
    expect(real.status).toBe(201)
    expect(unknown.status).toBe(201)
    expect(await json(real)).toEqual(await json(unknown))
  })

  it('does not share anything before the student approves', async () => {
    const list = await handlerFor(StudentsRoute, 'GET')({ request: request(parent.cookie) })
    expect(await list.json()).toEqual([])
  })

  it('only the invited student sees and can answer the request', async () => {
    const incoming = await handlerFor(IncomingRoute, 'GET')({ request: request(student.cookie) })
    const { invites } = await incoming.json()
    expect(invites).toHaveLength(1)

    const wrong = await handlerFor(RespondRoute, 'POST')({
      request: request(stranger.cookie, { approve: true }),
      params: { id: invites[0].id },
    })
    expect(wrong.status).toBe(403)

    const approve = await handlerFor(RespondRoute, 'POST')({
      request: request(student.cookie, { approve: true }),
      params: { id: invites[0].id },
    })
    expect(approve.status).toBe(200)
  })

  it('approval moves her into the guardian household, and only that one', async () => {
    const mine = await handlerFor(StudentsRoute, 'GET')({ request: request(parent.cookie) })
    const rows = await mine.json()
    expect(rows.map((r: { id: string }) => r.id)).toEqual([studentRowId])

    const others = await handlerFor(StudentsRoute, 'GET')({ request: request(stranger.cookie) })
    expect(await others.json()).toEqual([])

    const user = await db
      .selectFrom('users')
      .select('household_id')
      .where('id', '=', student.userId)
      .executeTakeFirstOrThrow()
    expect(user.household_id).toBe(parent.householdId)
    const consents = await db
      .selectFrom('consents')
      .select('given_by_user_id')
      .where('student_id', '=', studentRowId)
      .execute()
    expect(consents.map((c) => c.given_by_user_id)).toContain(parent.userId)
  })

  it('a second guardian must wait until the first link ends', async () => {
    await handlerFor(InvitesRoute, 'POST')({
      request: request(teacher.cookie, { student_email: student.email, consent: true }),
    })
    const incoming = await handlerFor(IncomingRoute, 'GET')({ request: request(student.cookie) })
    const { invites, linkedTo } = await incoming.json()
    expect(linkedTo).not.toBeNull()
    expect(invites).toHaveLength(1)
    const blocked = await handlerFor(RespondRoute, 'POST')({
      request: request(student.cookie, { approve: true }),
      params: { id: invites[0].id },
    })
    expect(blocked.status).toBe(409)
  })

  it('the student can stop sharing, then approve the next request', async () => {
    const leave = await handlerFor(LeaveRoute, 'POST')({ request: request(student.cookie, {}) })
    expect(leave.status).toBe(200)

    const after = await handlerFor(StudentsRoute, 'GET')({ request: request(parent.cookie) })
    expect(await after.json()).toEqual([])
    const row = await db
      .selectFrom('students')
      .select('household_id')
      .where('id', '=', studentRowId)
      .executeTakeFirstOrThrow()
    expect(row.household_id).toBe(student.householdId)

    const incoming = await handlerFor(IncomingRoute, 'GET')({ request: request(student.cookie) })
    const { invites } = await incoming.json()
    const approve = await handlerFor(RespondRoute, 'POST')({
      request: request(student.cookie, { approve: true }),
      params: { id: invites[0].id },
    })
    expect(approve.status).toBe(200)
    const teacherView = await handlerFor(StudentsRoute, 'GET')({ request: request(teacher.cookie) })
    expect((await teacherView.json()).map((r: { id: string }) => r.id)).toEqual([studentRowId])
  })

  it('a guardian can stop following, and another household cannot revoke it', async () => {
    const invites = await handlerFor(InvitesRoute, 'GET')({ request: request(teacher.cookie) })
    const list = await invites.json()
    const approved = list.find((i: { status: string }) => i.status === 'approved')

    const foreign = await handlerFor(RevokeRoute, 'POST')({
      request: request(stranger.cookie, {}),
      params: { id: approved.id },
    })
    expect(foreign.status).toBe(404)

    const revoke = await handlerFor(RevokeRoute, 'POST')({
      request: request(teacher.cookie, {}),
      params: { id: approved.id },
    })
    expect(revoke.status).toBe(200)
    const after = await handlerFor(StudentsRoute, 'GET')({ request: request(teacher.cookie) })
    expect(await after.json()).toEqual([])
  })
})
