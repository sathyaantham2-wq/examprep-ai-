import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  blueprintsRepository,
  papersRepository,
} from '../db/repositories'
import { createQuestion } from '../lib/questions'
import {
  createParentSession,
  createStudentSession,
} from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as PapersListRoute } from './api/papers'

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

function getRequest(url: string, cookie: string): Request {
  return new Request(url, { headers: { cookie } })
}

/**
 * F123 (M08): GET /api/papers -- the entry point into the online test engine that never existed
 * before this. A generated paper's id was previously only visible inside the raw
 * POST /api/papers/generate response body; nothing let a student (or the parent on her behalf)
 * discover it again afterwards to actually start it.
 */
describe('paper list & attempt entry point (F123)', () => {
  let db: Db
  let parentA: TestSession
  let studentA: TestSession
  let parentB: TestSession
  let studentAId: string
  let conceptId: string
  let chapterId: string
  let subjectId: string
  let blueprintId: string
  let paperId: string
  let zeroMarkPaperId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('paper-entry-a')
    parentB = await createParentSession('paper-entry-b')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'Paper Entry Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentResponse.json()).id
    studentA = await createStudentSession(
      'paper-entry-student',
      parentA.householdId,
      studentAId,
    )

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id
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
      code: `C7M-1.PAPERENTRY-${Date.now()}`,
      name: 'Paper entry fixture concept',
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
      text: 'Paper entry fixture question',
      answer: '4',
      created_by: 'paper-entry-fixture',
      options: [
        { label: 'A', text: '4', is_correct: true, order_index: 1 },
        { label: 'B', text: '5', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Paper entry fixture blueprint',
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
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    paperId = (await generateResponse.json()).paper.id

    // Simulates the real leftover-fixture data this endpoint was found live to be leaking:
    // a stray test blueprint with no real sections produces a paper with total_marks 0 that
    // generatePaper() itself would never create (every real blueprint section requires a
    // positive marks_per_question/count) but that still sits in the shared dev DB forever,
    // since blueprints/papers are never hard-deleted.
    const zeroMarkPaper = await papersRepository.insert(db, {
      student_id: studentAId,
      blueprint_id: blueprintId,
      subject_id: subjectId,
      chapter_ids: [chapterId],
      title: 'Stray fixture blueprint',
      total_marks: 0,
      duration_min: 10,
    })
    zeroMarkPaperId = zeroMarkPaper.id
  })

  afterAll(async () => {
    const attempts = await db
      .selectFrom('attempts')
      .select('id')
      .where('paper_id', '=', paperId)
      .execute()
    const attemptIds = attempts.map((a) => a.id)
    if (attemptIds.length > 0) {
      await db
        .deleteFrom('attempt_answers')
        .where('attempt_id', 'in', attemptIds)
        .execute()
      await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    }
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', '=', paperId)
      .execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db
      .deleteFrom('papers')
      .where('id', '=', zeroMarkPaperId)
      .execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('created_by', '=', 'paper-entry-fixture').execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('rejects an unauthenticated request', async () => {
    const response = await handlerFor(PapersListRoute, 'GET')({
      request: getRequest('http://localhost/test', ''),
    })
    expect(response.status).toBe(401)
  })

  it('requires student_id for a parent/admin caller', async () => {
    const response = await handlerFor(PapersListRoute, 'GET')({
      request: getRequest('http://localhost/test', parentA.cookie),
    })
    expect(response.status).toBe(400)
  })

  it("404s a parent asking for a student outside their own household", async () => {
    const response = await handlerFor(PapersListRoute, 'GET')({
      request: getRequest(
        `http://localhost/test?student_id=${studentAId}`,
        parentB.cookie,
      ),
    })
    expect(response.status).toBe(404)
  })

  it('a student sees their own generated paper with no attempt yet', async () => {
    const response = await handlerFor(PapersListRoute, 'GET')({
      request: getRequest('http://localhost/test', studentA.cookie),
    })
    expect(response.status).toBe(200)
    const body: Array<{ id: string; attempt: unknown }> = await response.json()
    const mine = body.find((p) => p.id === paperId)
    expect(mine).toBeDefined()
    expect(mine!.attempt).toBeNull()
  })

  it('excludes a stray zero-mark paper (leftover fixture blueprint) from the list', async () => {
    const response = await handlerFor(PapersListRoute, 'GET')({
      request: getRequest('http://localhost/test', studentA.cookie),
    })
    const body: Array<{ id: string }> = await response.json()
    expect(body.some((p) => p.id === zeroMarkPaperId)).toBe(false)
  })

  it('the parent sees the same paper via student_id', async () => {
    const response = await handlerFor(PapersListRoute, 'GET')({
      request: getRequest(
        `http://localhost/test?student_id=${studentAId}`,
        parentA.cookie,
      ),
    })
    expect(response.status).toBe(200)
    const body: Array<{ id: string }> = await response.json()
    expect(body.some((p) => p.id === paperId)).toBe(true)
  })

  it('starting an attempt makes it show up as in_progress on the list', async () => {
    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(studentA.cookie, { paper_id: paperId, mode: 'online' }),
    })
    expect(attemptResponse.status).toBe(201)
    const attempt = await attemptResponse.json()

    const response = await handlerFor(PapersListRoute, 'GET')({
      request: getRequest('http://localhost/test', studentA.cookie),
    })
    const body: Array<{
      id: string
      attempt: { id: string; status: string; attempted_at: string } | null
    }> = await response.json()
    const mine = body.find((p) => p.id === paperId)
    // attempted_at (2026-09-24, F123 follow-up for /papers-attempted): submitted_at is still null
    // this early, so it falls back to started_at -- a real server timestamp, not asserted exactly.
    expect(mine!.attempt?.id).toBe(attempt.id)
    expect(mine!.attempt?.status).toBe('in_progress')
    expect(new Date(mine!.attempt!.attempted_at).toString()).not.toBe('Invalid Date')
  })
})
