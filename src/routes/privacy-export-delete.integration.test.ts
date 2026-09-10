import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as ExportRoute } from './api/privacy/export'
import { Route as DeleteRoute } from './api/privacy/delete'
import { Route as HouseholdMeRoute } from './api/households/me'

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
    method: body !== undefined ? 'POST' : 'GET',
    headers: {
      cookie,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * F098: the export must contain the household's own real data; delete must actually erase every
 * table that cascades from households.id (verified by re-querying after, not assumed from the
 * migrations) while the deletion_log row survives -- it deliberately does not reference
 * households.id, or it would vanish in the same transaction it's supposed to prove happened.
 */
describe('privacy export and delete (F098)', () => {
  let db: Db
  let parent: TestSession
  let studentId: string
  let householdName: string
  let deleted = false

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('privacy')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Privacy Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id

    const householdResponse = await handlerFor(
      HouseholdMeRoute,
      'GET',
    )({ request: request(parent.cookie) })
    householdName = (await householdResponse.json()).name
  })

  afterAll(async () => {
    if (!deleted) {
      await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    }
    await db
      .deleteFrom('deletion_log')
      .where('household_id', '=', parent.householdId)
      .execute()
    await db.destroy()
  })

  it('rejects an unauthenticated export request', async () => {
    const response = await handlerFor(ExportRoute, 'POST')({ request: request('') })
    expect(response.status).toBe(401)
  })

  it('exports the household including the real student', async () => {
    const response = await handlerFor(
      ExportRoute,
      'POST',
    )({ request: request(parent.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.household.id).toBe(parent.householdId)
    expect(body.students.some((s: { id: string }) => s.id === studentId)).toBe(true)
  })

  it('rejects delete with a wrong confirmation name', async () => {
    const response = await handlerFor(
      DeleteRoute,
      'POST',
    )({ request: request(parent.cookie, { confirm_household_name: 'not the real name' }) })
    expect(response.status).toBe(400)
  })

  it('deletes the household on a correct confirmation, cascading everything', async () => {
    const response = await handlerFor(
      DeleteRoute,
      'POST',
    )({ request: request(parent.cookie, { confirm_household_name: householdName }) })
    expect(response.status).toBe(204)
    deleted = true

    const household = await db
      .selectFrom('households')
      .selectAll()
      .where('id', '=', parent.householdId)
      .executeTakeFirst()
    expect(household).toBeUndefined()

    const student = await db
      .selectFrom('students')
      .selectAll()
      .where('id', '=', studentId)
      .executeTakeFirst()
    expect(student).toBeUndefined()

    const logRow = await db
      .selectFrom('deletion_log')
      .selectAll()
      .where('household_id', '=', parent.householdId)
      .executeTakeFirst()
    expect(logRow).toBeDefined()
    expect(logRow!.household_name).toBe(householdName)
  })

  it('a session from the deleted household is no longer authenticated', async () => {
    const response = await handlerFor(
      ExportRoute,
      'POST',
    )({ request: request(parent.cookie) })
    expect(response.status).toBe(401)
  })
})
