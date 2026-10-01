import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth } from '../lib/auth'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as DeleteSelfRoute } from './api/privacy/delete-self'
import { Route as HouseholdDeleteRoute } from './api/privacy/delete'

type RouteHandler = (opts: { request: Request }) => Promise<Response>
const handler = (method: string) =>
  (DeleteSelfRoute.options.server as unknown as { handlers: Record<string, RouteHandler> }).handlers[method]

const req = (cookie: string, method = 'GET', body?: unknown) =>
  new Request('http://localhost/test', {
    method,
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

const TAG = `selfdel-${Date.now()}`

/** A student who signed up on her own, the way the real sign-up form does it. */
async function selfSignUp(name: string) {
  const email = `${TAG}-${name}@example.com`
  const response = await auth.handler(
    new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: 'correcthorsebatterystaple', name, signup_type: 'student' }),
    }),
  )
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('sign-up returned no session cookie')
  return { email, cookie }
}

describe('F098 / Google Play: a student can delete her own account only if no parent looks after it', () => {
  let db: Db
  let parent: TestSession
  let parentManaged: TestSession
  let parentManagedStudentId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession(TAG)
    const kid = await (StudentsRoute.options.server as unknown as { handlers: Record<string, RouteHandler> }).handlers.POST({
      request: req(parent.cookie, 'POST', { name: 'Managed Kid', class: 7, board: 'CBSE', consent_accepted: true }),
    })
    parentManagedStudentId = (await kid.json()).id
    parentManaged = await createStudentSession(`${TAG}-managed`, parent.householdId, parentManagedStudentId)
  })

  afterAll(async () => {
    const users = await db.selectFrom('users').select('household_id').where('email', 'like', `${TAG}%`).execute()
    const ids = [...new Set([parent.householdId, ...users.map((u) => u.household_id)])]
    // Consents RESTRICT their giver's deletion; clear them first (deleteHouseholdData orders this itself).
    const tagUsers = db.selectFrom('users').select('id').where('email', 'like', `${TAG}%`)
    const origins = await db.selectFrom('students').select('own_household_id').where('user_id', 'in', tagUsers).execute()
    const all = [...new Set([...ids, ...origins.flatMap((o) => (o.own_household_id ? [o.own_household_id] : []))])]
    await db.deleteFrom('consents').where('given_by_user_id', 'in', tagUsers).execute()
    await db.deleteFrom('households').where('id', 'in', ids).execute()
    await db.deleteFrom('households').where('id', 'in', all).execute()
    await db.deleteFrom('deletion_log').where('household_name', 'like', `${TAG}%`).execute()
    await db.destroy()
  })

  it('a self-signed-up student is told she may, and deleting removes her login, profile and household', async () => {
    const solo = await selfSignUp(`${TAG}-solo`)
    const user = await db.selectFrom('users').select(['id', 'household_id']).where('email', '=', solo.email).executeTakeFirstOrThrow()
    await db.updateTable('households').set({ name: `${TAG} solo household` }).where('id', '=', user.household_id).execute()

    expect(await (await handler('GET')({ request: req(solo.cookie) })).json()).toEqual({ allowed: true })

    // No silent deletes: the confirmation word is required.
    expect((await handler('POST')({ request: req(solo.cookie, 'POST', {}) })).status).toBe(400)
    expect((await handler('POST')({ request: req(solo.cookie, 'POST', { confirm: 'delete' }) })).status).toBe(400)

    expect((await handler('POST')({ request: req(solo.cookie, 'POST', { confirm: 'DELETE' }) })).status).toBe(204)

    expect(await db.selectFrom('users').select('id').where('id', '=', user.id).executeTakeFirst()).toBeUndefined()
    expect(await db.selectFrom('students').select('id').where('user_id', '=', user.id).executeTakeFirst()).toBeUndefined()
    expect(await db.selectFrom('households').select('id').where('id', '=', user.household_id).executeTakeFirst()).toBeUndefined()
    const logged = await db.selectFrom('deletion_log').selectAll().where('household_id', '=', user.household_id).executeTakeFirstOrThrow()
    expect(logged.requested_by_user_id).toBe(user.id)
    // Her session died with the account.
    expect((await handler('GET')({ request: req(solo.cookie) })).status).toBe(401)
  })

  it('a student a parent added is refused, and nothing is deleted', async () => {
    expect(await (await handler('GET')({ request: req(parentManaged.cookie) })).json()).toEqual({
      allowed: false,
      reason: 'parent_managed',
    })
    const res = await handler('POST')({ request: req(parentManaged.cookie, 'POST', { confirm: 'DELETE' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).message).toMatch(/Ask them to delete it/)
    expect(await db.selectFrom('students').select('id').where('id', '=', parentManagedStudentId).executeTakeFirst()).toBeDefined()
    expect(await db.selectFrom('households').select('id').where('id', '=', parent.householdId).executeTakeFirst()).toBeDefined()
  })

  it('a self-signed-up student whom a parent now follows is refused (the parent household survives)', async () => {
    const linked = await selfSignUp(`${TAG}-linked`)
    const user = await db.selectFrom('users').select(['id', 'household_id']).where('email', '=', linked.email).executeTakeFirstOrThrow()
    // What approving a guardian invite does (src/lib/guardian-links.ts): move her into their household.
    await db.updateTable('students').set({ household_id: parent.householdId }).where('user_id', '=', user.id).execute()
    await db.updateTable('users').set({ household_id: parent.householdId }).where('id', '=', user.id).execute()

    expect(await (await handler('GET')({ request: req(linked.cookie) })).json()).toEqual({
      allowed: false,
      reason: 'parent_linked',
    })
    expect((await handler('POST')({ request: req(linked.cookie, 'POST', { confirm: 'DELETE' }) })).status).toBe(403)
    expect(await db.selectFrom('users').select('id').where('id', '=', user.id).executeTakeFirst()).toBeDefined()
    expect(await db.selectFrom('households').select('id').where('id', '=', parent.householdId).executeTakeFirst()).toBeDefined()
  })

  it('parents use the existing household delete, not this route', async () => {
    expect((await handler('GET')({ request: req(parent.cookie) })).status).toBe(403)
    expect((await handler('POST')({ request: req(parent.cookie, 'POST', { confirm: 'DELETE' }) })).status).toBe(403)
    expect((await handler('POST')({ request: req('', 'POST', { confirm: 'DELETE' }) })).status).toBe(401)
  })

  it('a parent can still delete their household when a self-signed-up student is linked into it', async () => {
    const otherParent = await createParentSession(`${TAG}-p2`)
    const kid = await selfSignUp(`${TAG}-kid2`)
    const user = await db.selectFrom('users').select(['id', 'household_id']).where('email', '=', kid.email).executeTakeFirstOrThrow()
    await db.updateTable('students').set({ household_id: otherParent.householdId }).where('user_id', '=', user.id).execute()
    await db.updateTable('users').set({ household_id: otherParent.householdId }).where('id', '=', user.id).execute()
    const household = await db.selectFrom('households').select('name').where('id', '=', otherParent.householdId).executeTakeFirstOrThrow()

    const res = await (HouseholdDeleteRoute.options.server as unknown as { handlers: Record<string, RouteHandler> }).handlers.POST({
      request: req(otherParent.cookie, 'POST', { confirm_household_name: household.name }),
    })
    expect(res.status).toBe(204)
    expect(await db.selectFrom('users').select('id').where('id', '=', user.id).executeTakeFirst()).toBeUndefined()
    // Her own (now empty) household and the consent she gave there go with her.
    expect(await db.selectFrom('households').select('id').where('id', '=', user.household_id).executeTakeFirst()).toBeUndefined()
  })
})
