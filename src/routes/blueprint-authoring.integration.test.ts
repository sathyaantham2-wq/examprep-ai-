import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as BlueprintsRoute } from './api/blueprints'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  const handlers = (route.options.server as { handlers: Record<string, RouteHandler> }).handlers
  return handlers[method]
}

function request(cookie: string, body: unknown): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBloomTargets = {
  Remember: 20, Understand: 20, Apply: 30, Analyse: 20, Evaluate: 5, Create: 5,
}

/**
 * F086: POST /api/blueprints had no dedicated test before this -- every prior test that needed a
 * blueprint called blueprintsRepository.insert() directly, bypassing the route's own validation
 * (admin-only, bloom_targets must sum to 100, total_marks computed from sections rather than
 * trusted from the client).
 */
describe('blueprint authoring (F086)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let subjectId: string
  const createdBlueprintIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('blueprint-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('blueprint-parent')

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id
  })

  afterAll(async () => {
    if (createdBlueprintIds.length > 0) {
      await db.deleteFrom('blueprints').where('id', 'in', createdBlueprintIds).execute()
    }
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.destroy()
  })

  it('rejects a non-admin request', async () => {
    const response = await handlerFor(
      BlueprintsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        subject_id: subjectId,
        board: 'CBSE',
        class: 7,
        name: 'Should not be created',
        duration_min: 60,
        sections: [{ name: 'A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] }],
        bloom_targets: validBloomTargets,
      }),
    })
    expect(response.status).toBe(403)
  })

  it('rejects bloom_targets that do not sum to 100', async () => {
    const response = await handlerFor(
      BlueprintsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        subject_id: subjectId,
        board: 'CBSE',
        class: 7,
        name: 'Bad bloom targets',
        duration_min: 60,
        sections: [{ name: 'A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] }],
        bloom_targets: { ...validBloomTargets, Remember: 50 },
      }),
    })
    expect(response.status).toBe(400)
  })

  it('computes total_marks from sections rather than trusting the client', async () => {
    const response = await handlerFor(
      BlueprintsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        subject_id: subjectId,
        board: 'CBSE',
        class: 7,
        name: `F086 fixture blueprint ${Date.now()}`,
        duration_min: 120,
        sections: [
          { name: 'Section A', marks_per_question: 1, count: 5, bloom_allowed: ['Remember'] },
          { name: 'Section B', marks_per_question: 3, count: 5, bloom_allowed: ['Apply'] },
        ],
        bloom_targets: validBloomTargets,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    createdBlueprintIds.push(body.id)
    expect(body.total_marks).toBe(1 * 5 + 3 * 5)
  })

  it('F030: accepts a valid choice_rules entry and stores it', async () => {
    const response = await handlerFor(
      BlueprintsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        subject_id: subjectId,
        board: 'CBSE',
        class: 7,
        name: `F030 fixture blueprint ${Date.now()}`,
        duration_min: 60,
        sections: [
          { name: 'Section A', marks_per_question: 2, count: 3, bloom_allowed: ['Remember'] },
        ],
        bloom_targets: validBloomTargets,
        choice_rules: [{ section: 'Section A', count: 1 }],
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    createdBlueprintIds.push(body.id)
    expect(body.choice_rules).toEqual([{ section: 'Section A', count: 1 }])
  })

  it('F030: rejects a choice_rules entry naming a section that does not exist', async () => {
    const response = await handlerFor(
      BlueprintsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        subject_id: subjectId,
        board: 'CBSE',
        class: 7,
        name: 'Bad choice_rules section',
        duration_min: 60,
        sections: [
          { name: 'Section A', marks_per_question: 2, count: 3, bloom_allowed: ['Remember'] },
        ],
        bloom_targets: validBloomTargets,
        choice_rules: [{ section: 'Section Z', count: 1 }],
      }),
    })
    expect(response.status).toBe(400)
  })

  it("F030: rejects a choice_rules count that exceeds its section's own slot count", async () => {
    const response = await handlerFor(
      BlueprintsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        subject_id: subjectId,
        board: 'CBSE',
        class: 7,
        name: 'Bad choice_rules count',
        duration_min: 60,
        sections: [
          { name: 'Section A', marks_per_question: 2, count: 2, bloom_allowed: ['Remember'] },
        ],
        bloom_targets: validBloomTargets,
        choice_rules: [{ section: 'Section A', count: 3 }],
      }),
    })
    expect(response.status).toBe(400)
  })
})
