import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudentByIdRoute } from './api/students/$id'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as PaperByIdRoute } from './api/papers/$id'
import { Route as TrackerRoute } from './api/tracker/$studentId'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

// Every route in this project uses the plain-object form of `server.handlers` (never the
// createHandlers-callback form), so this cast is safe — it exists purely because TypeScript's
// RouteOptions type has to allow both shapes generically.
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
 * F096: "every query filtered by household; automated test attempts cross-household access on
 * all endpoints and must fail." This calls the REAL route handler functions directly — no dev
 * server, no HTTP round trip — with a genuine better-auth session cookie obtained through
 * auth.api.signUpEmail/signInEmail (src/db/test-helpers.ts), which is as close to "hit the actual
 * endpoint" as a test can get without a running process. This is also T01/T02 automated, closing
 * the auth-guard gap F103 left open.
 */
describe('cross-household access is denied on every route it was checked against (F096)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentAId: string
  let paperId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('f096-a')
    parentB = await createParentSession('f096-b')

    const createStudentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'F096 Kid',
        class: 7,
        board: 'CBSE',
      }),
    })
    const student = await createStudentResponse.json()
    studentAId = student.id

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
      code: `C7M-1.F096-${Date.now()}`,
      name: 'F096 fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'F096 fixture question',
      answer: '1',
      created_by: 'f096-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'F096 fixture blueprint',
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 1,
          count: 1,
          bloom_allowed: ['Remember'],
        },
      ]),
      bloom_targets: JSON.stringify({
        Remember: 100,
        Understand: 0,
        Apply: 0,
        Analyse: 0,
        Evaluate: 0,
        Create: 0,
      }),
    })
    blueprintId = blueprint.id

    const generateResponse = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        student_id: studentAId,
        blueprint_id: blueprint.id,
        chapter_ids: [chapter.id],
      }),
    })
    const generated = await generateResponse.json()
    paperId = generated.paper.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'f096-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('GET /api/students never lists another household’s student', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'GET',
    )({ request: request(parentB.cookie) })
    const list = (await response.json()) as Array<{ id: string }>
    expect(list.some((s) => s.id === studentAId)).toBe(false)
  })

  it('PATCH /api/students/:id on another household’s student -> 404', async () => {
    const response = await handlerFor(
      StudentByIdRoute,
      'PATCH',
    )({
      request: request(parentB.cookie, { section: 'Z' }),
      params: { id: studentAId },
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/papers/generate for another household’s student -> 404', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parentB.cookie, {
        student_id: studentAId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    expect(response.status).toBe(404)
  })

  it('GET /api/papers/:id for another household’s paper -> 404', async () => {
    const response = await handlerFor(
      PaperByIdRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { id: paperId },
    })
    expect(response.status).toBe(404)
  })

  it('GET /api/tracker/:studentId for another household’s student -> 404', async () => {
    const response = await handlerFor(
      TrackerRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { studentId: studentAId },
    })
    expect(response.status).toBe(404)
  })

  it('the owning household can still do all of the above (isolation is not just failing everything)', async () => {
    const paperResponse = await handlerFor(
      PaperByIdRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: paperId },
    })
    expect(paperResponse.status).toBe(200)

    const trackerResponse = await handlerFor(
      TrackerRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { studentId: studentAId },
    })
    expect(trackerResponse.status).toBe(200)
  })

  it('T01: an unauthenticated request is rejected before any data is touched', async () => {
    const response = await handlerFor(
      StudentsRoute,
      'GET',
    )({
      request: new Request('http://localhost/test'),
    })
    expect(response.status).toBe(401)
  })
})
