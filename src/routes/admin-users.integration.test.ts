import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth } from '../lib/auth'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  createParentSession,
  promoteToAdmin,
  TEST_PASSWORD,
} from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as UsersRoute } from './api/households/users'
import { Route as UserByIdRoute } from './api/households/users/$id'
import { Route as HouseholdMeRoute } from './api/households/me'

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

/** Inserts a second parent-role user directly into an existing household and signs in for a
 * real session -- mirrors test-helpers.ts's createStudentSession, since signUpEmail always
 * starts a brand-new household and there is otherwise no way to get two users into one. */
async function addSecondParent(
  db: Db,
  householdId: string,
): Promise<TestSession> {
  const { hashPassword } = await import('better-auth/crypto')
  const email = `f083-second-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const hash = await hashPassword(TEST_PASSWORD)

  const user = await db
    .insertInto('users')
    .values({
      household_id: householdId,
      email,
      name: 'F083 second parent',
      role: 'parent',
      email_verified: true,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  await db
    .insertInto('accounts')
    .values({
      issuer: 'local:credential',
      account_id: user.id,
      provider_id: 'credential',
      user_id: user.id,
      password: hash,
    })
    .execute()

  const signIn = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    asResponse: true,
  })
  const cookie = signIn.headers.get('set-cookie')
  if (!cookie) throw new Error('Sign-in did not return a session cookie')

  return {
    cookie: cookie.split(';')[0],
    userId: user.id,
    householdId,
    email,
    password: TEST_PASSWORD,
  }
}

/**
 * F083: the last piece of the admin console's literal AC list ("Manage ... users"). Covers the
 * list/toggle routes, the household-scoping guard (T02), the self-deactivation guard, the audit
 * log write, and -- the part that actually matters -- that deactivation is enforced server-side
 * in session.ts and takes effect on the deactivated user's very next request, not just at their
 * next sign-in.
 */
describe('admin users management (F083)', () => {
  let db: Db
  let admin: TestSession
  let secondParent: TestSession

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('f083-admin')
    await promoteToAdmin(admin.userId)
    secondParent = await addSecondParent(db, admin.householdId)
  })

  afterAll(async () => {
    await db
      .deleteFrom('audit_log')
      .where('household_id', '=', admin.householdId)
      .execute()
    await db
      .deleteFrom('households')
      .where('id', '=', admin.householdId)
      .execute()
    await db.destroy()
  })

  it('rejects an unauthenticated request', async () => {
    const response = await handlerFor(UsersRoute, 'GET')({
      request: request(''),
    })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin parent', async () => {
    const response = await handlerFor(UsersRoute, 'GET')({
      request: request(secondParent.cookie),
    })
    expect(response.status).toBe(403)
  })

  it('lists every user in the admin’s household', async () => {
    const response = await handlerFor(UsersRoute, 'GET')({
      request: request(admin.cookie),
    })
    expect(response.status).toBe(200)
    const body: Array<{ id: string; email: string }> = await response.json()
    const emails = body.map((u) => u.email)
    expect(emails).toContain(admin.email)
    expect(emails).toContain(secondParent.email)
  })

  it('refuses to let an admin deactivate their own account', async () => {
    const response = await handlerFor(
      UserByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, { is_active: false }),
      params: { id: admin.userId },
    })
    expect(response.status).toBe(400)
  })

  it('404s for a user id outside the caller’s household', async () => {
    const response = await handlerFor(
      UserByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, { is_active: false }),
      params: { id: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.status).toBe(404)
  })

  it('deactivates a user, writes an audit log row, and immediately locks them out', async () => {
    // Before deactivation, the second parent's own session works normally.
    const before = await handlerFor(HouseholdMeRoute, 'GET')({
      request: request(secondParent.cookie),
    })
    expect(before.status).toBe(200)

    const patchResponse = await handlerFor(
      UserByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, { is_active: false }),
      params: { id: secondParent.userId },
    })
    expect(patchResponse.status).toBe(200)
    const updated = await patchResponse.json()
    expect(updated.is_active).toBe(false)

    const auditRow = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_id', '=', secondParent.userId)
      .where('action', '=', 'user.deactivated')
      .executeTakeFirstOrThrow()
    expect(auditRow.actor_user_id).toBe(admin.userId)

    // The existing session cookie is still the same token, but the account behind it is now
    // deactivated -- session.ts's getCurrentUser must reject it on this very next request.
    const after = await handlerFor(HouseholdMeRoute, 'GET')({
      request: request(secondParent.cookie),
    })
    expect(after.status).toBe(401)
  })

  it('reactivates a user and restores their access', async () => {
    const patchResponse = await handlerFor(
      UserByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, { is_active: true }),
      params: { id: secondParent.userId },
    })
    expect(patchResponse.status).toBe(200)

    const after = await handlerFor(HouseholdMeRoute, 'GET')({
      request: request(secondParent.cookie),
    })
    expect(after.status).toBe(200)
  })
})
