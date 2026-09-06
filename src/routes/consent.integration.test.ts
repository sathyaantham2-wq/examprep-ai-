import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as ConsentWithdrawRoute } from './api/students/$id/consent/withdraw'
import { Route as GenerateRoute } from './api/papers/generate'

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
 * F095: "Consent captured at student creation with purpose and retention stated ...; withdrawal
 * supported." This is the technical mechanism only -- CONSENT_NOTICE's wording
 * (src/lib/consent.ts) is a placeholder, not reviewed legal copy, and real DPDP compliance needs
 * more than what a codebase can certify on its own (verifiable parental identity, a real privacy
 * policy). What's tested here: consent is mandatory at creation, is recorded, can be withdrawn,
 * and withdrawal actually blocks new content generation for that student.
 */
describe('DPDP consent capture and withdrawal (F095)', () => {
  let db: Db
  let parent: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('consent')

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const chapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .where('chapter_no', '=', 1)
      .executeTakeFirstOrThrow()
    chapterId = chapter.id

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.CONSENT-${Date.now()}`,
      name: 'Consent fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Consent fixture blueprint',
      duration_min: 10,
      // total_marks just describes the blueprint's advertised size (check constraint > 0) --
      // it's never cross-checked against the sections array, so an empty-sections blueprint with
      // a nonzero total_marks is a valid (if minimal) fixture for exercising the consent gate.
      total_marks: 1,
      sections: JSON.stringify([]),
      bloom_targets: JSON.stringify({
        Remember: 0,
        Understand: 0,
        Apply: 0,
        Analyse: 0,
        Evaluate: 0,
        Create: 0,
      }),
    })
    blueprintId = blueprint.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('POST /api/students rejects creation without consent_accepted', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'No Consent Kid',
        class: 7,
        board: 'CBSE',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('POST /api/students rejects consent_accepted: false explicitly', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'No Consent Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: false,
      }),
    })
    expect(response.status).toBe(400)
  })

  it('POST /api/students creates a student and a matching consent row when accepted', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Consent Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    expect(response.status).toBe(201)
    const student = await response.json()
    studentId = student.id

    const consent = await db
      .selectFrom('consents')
      .selectAll()
      .where('student_id', '=', studentId)
      .executeTakeFirst()
    expect(consent).toBeDefined()
    expect(consent?.withdrawn_at).toBeNull()
  })

  it('paper generation succeeds while consent is active', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    // 201 even with zero sections/marks -- generatePaper succeeds with an empty paper; the point
    // here is that it got past the consent gate, not the paper's own content.
    expect(response.status).toBe(201)
  })

  it('POST /api/students/:id/consent/withdraw records the withdrawal', async () => {
    const response = await handlerFor(
      ConsentWithdrawRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: studentId },
    })
    expect(response.status).toBe(200)
    const withdrawn = await response.json()
    expect(withdrawn.withdrawn_at).not.toBeNull()
  })

  it('withdrawing again with nothing active returns 409', async () => {
    const response = await handlerFor(
      ConsentWithdrawRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: studentId },
    })
    expect(response.status).toBe(409)
  })

  it('paper generation is blocked once consent is withdrawn', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    expect(response.status).toBe(403)
  })

  it('another household cannot withdraw consent for a student that is not theirs', async () => {
    const otherParent = await createParentSession('consent-other')
    const response = await handlerFor(
      ConsentWithdrawRoute,
      'POST',
    )({
      request: request(otherParent.cookie, {}),
      params: { id: studentId },
    })
    expect(response.status).toBe(404)
    await db
      .deleteFrom('households')
      .where('id', '=', otherParent.householdId)
      .execute()
  })
})
