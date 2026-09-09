import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as CoverageGridRoute } from './api/questions/coverage-grid'

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

function request(cookie: string): Request {
  return new Request('http://localhost/test', { headers: { cookie } })
}

/**
 * F115: "a 6 Bloom x 3 difficulty grid shows counts and target counts." Runs against F012's real
 * seed data (60 concepts, 200 questions with a deliberately sparse per-concept bloom/difficulty
 * spread -- 3-4 questions per concept out of 18 possible cells), so "most cells empty" is the
 * real, expected shape here, not a fixture artifact.
 */
describe('question bank coverage grid (F115)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let mathSubjectId: string
  let firstNewConceptId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('coverage-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('coverage-parent')

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    mathSubjectId = subject.id

    // Any of F012's seed concepts under chapter_no >= 3 works -- all were built with the same
    // 3-4-questions-out-of-18-cells pattern.
    const concept = await db
      .selectFrom('concepts')
      .innerJoin('chapters', 'chapters.id', 'concepts.chapter_id')
      .select('concepts.id')
      .where('chapters.subject_id', '=', subject.id)
      .where('chapters.chapter_no', '>=', 3)
      .executeTakeFirstOrThrow()
    firstNewConceptId = concept.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.destroy()
  })

  it('requires admin -- a parent session is rejected', async () => {
    const response = await handlerFor(
      CoverageGridRoute,
      'GET',
    )({
      request: request(parent.cookie),
    })
    expect(response.status).toBe(403)
  })

  it('rejects a request with neither concept_id nor subject_id', async () => {
    const response = await handlerFor(
      CoverageGridRoute,
      'GET',
    )({
      request: request(admin.cookie),
    })
    expect(response.status).toBe(400)
  })

  it('returns an 18-cell grid for a single concept with mostly-empty cells', async () => {
    const response = await handlerFor(
      CoverageGridRoute,
      'GET',
    )({
      request: new Request(
        `http://localhost/test?concept_id=${firstNewConceptId}`,
        {
          headers: { cookie: admin.cookie },
        },
      ),
    })
    expect(response.status).toBe(200)
    const grid = await response.json()
    expect(grid.cells).toHaveLength(18)

    const totalQuestions = grid.cells.reduce(
      (sum: number, c: { count: number }) => sum + c.count,
      0,
    )
    expect(totalQuestions).toBeGreaterThan(0)
    expect(totalQuestions).toBeLessThan(18)
    expect(grid.empty_cells).toBeGreaterThan(0)
    expect(grid.empty_cells).toBe(
      18 - grid.cells.filter((c: { count: number }) => c.count > 0).length,
    )
  })

  it('returns one grid per concept for a whole subject, worst-coverage first', async () => {
    const response = await handlerFor(
      CoverageGridRoute,
      'GET',
    )({
      request: new Request(
        `http://localhost/test?subject_id=${mathSubjectId}`,
        {
          headers: { cookie: admin.cookie },
        },
      ),
    })
    expect(response.status).toBe(200)
    const grids = await response.json()
    expect(grids.length).toBeGreaterThanOrEqual(60)

    for (let i = 1; i < grids.length; i++) {
      expect(grids[i - 1].empty_cells).toBeGreaterThanOrEqual(
        grids[i].empty_cells,
      )
    }
  })
})
