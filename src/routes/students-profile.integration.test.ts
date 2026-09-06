import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentByIdRoute } from './api/students/$id'

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
 * F009: "Profile: name, class, section, roll no, board, school, ... target exam dates". Every
 * field except "subjects active" already had a column (F008's schema) -- the real gap was that
 * neither POST nor PATCH could ever write target_exams (stuck at [] forever) and POST couldn't
 * set section at creation time. "subjects active" stays out of scope: the whole product is
 * single-subject today (CLAUDE.md launch scope is CBSE Class 7 Maths only), so there is nothing
 * for that field to distinguish yet -- see tab17 for when multi-subject rollout would need it.
 */
describe('student profile fields round-trip (F009)', () => {
  let db: Db
  let parent: TestSession
  let studentId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('f009')
  })

  afterAll(async () => {
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.destroy()
  })

  it('POST /api/students accepts section and target_exams at creation', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'F009 Kid',
        class: 7,
        board: 'CBSE',
        school: 'Test School',
        section: 'B',
        roll_no: '17',
        target_exams: [{ name: 'Unit Test 1', date: '2026-03-01' }],
      }),
    })
    expect(response.status).toBe(201)
    const student = await response.json()
    studentId = student.id
    expect(student.section).toBe('B')
    expect(student.target_exams).toEqual([
      { name: 'Unit Test 1', date: '2026-03-01' },
    ])
  })

  it('PATCH /api/students/:id can update target_exams without touching other fields', async () => {
    const response = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, {
        target_exams: [
          { name: 'Unit Test 1', date: '2026-03-01' },
          { name: 'Final Exam', date: '2026-11-15' },
        ],
      }),
      params: { id: studentId },
    })
    expect(response.status).toBe(200)
    const updated = await response.json()
    expect(updated.target_exams).toHaveLength(2)
    // Untouched by this PATCH -- confirms a partial update didn't clobber the rest of the row.
    expect(updated.name).toBe('F009 Kid')
    expect(updated.section).toBe('B')
  })

  it('PATCH rejects a target_exams entry missing a valid date', async () => {
    const response = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, {
        target_exams: [{ name: 'Bad entry', date: 'not-a-date' }],
      }),
      params: { id: studentId },
    })
    expect(response.status).toBe(400)
  })
})
