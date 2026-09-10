import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { chapterScopeRepository, conceptsRepository } from '../db/repositories'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as GenerateRoute } from './api/questions/generate'

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
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

/**
 * F025: POST /api/questions/generate. No ANTHROPIC_API_KEY is configured in this environment
 * (see .env.example), so the real AI-01 call path is exercised only up to the documented
 * fallback here — validateCandidates() (the deterministic guardrail half) has its own unit
 * coverage in ai-question-generation.test.ts.
 */
describe('AI question generation (F025)', () => {
  let db: Db
  let admin: TestSession
  let scopedConceptId: string
  let unscopedConceptId: string
  let scopedChapterId: string
  let unscopedChapterId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('question-gen-admin')
    await promoteToAdmin(admin.userId)

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const existingChapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .executeTakeFirstOrThrow()

    const chapter = await db
      .insertInto('chapters')
      .values({
        subject_id: subject.id,
        source_id: existingChapter.source_id,
        part: 'Test Part',
        chapter_no: 9000 + Math.floor(Math.random() * 1000),
        name: 'F025 fixture chapter',
        order_index: 999,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    scopedChapterId = chapter.id

    await chapterScopeRepository.insertMany(db, [
      {
        chapter_id: chapter.id,
        kind: 'IN',
        item_text: 'Adding two integers with the same sign',
      },
    ])

    const scoped = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-9000.1-${Date.now()}`,
      name: 'F025 scoped fixture concept',
      difficulty_base: 'Easy',
    })
    scopedConceptId = scoped.id

    const unscopedChapter = await db
      .insertInto('chapters')
      .values({
        subject_id: subject.id,
        source_id: existingChapter.source_id,
        part: 'Test Part',
        chapter_no: 9500 + Math.floor(Math.random() * 1000),
        name: 'F025 unscoped fixture chapter',
        order_index: 998,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    unscopedChapterId = unscopedChapter.id

    const unscoped = await conceptsRepository.insert(db, {
      chapter_id: unscopedChapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-9500.1-${Date.now()}`,
      name: 'F025 unscoped fixture concept',
      difficulty_base: 'Easy',
    })
    unscopedConceptId = unscoped.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('concepts')
      .where('id', 'in', [scopedConceptId, unscopedConceptId])
      .execute()
    // Chapter rows aren't product data (drafts/approved questions etc. are, per CLAUDE.md
    // invariant 4) -- they're this test's own fixtures, and leaving them behind let a later run's
    // random chapter_no collide with one from a prior run (chapters_source_part_no_key), which is
    // exactly what happened before this cleanup was added.
    await db
      .deleteFrom('chapters')
      .where('id', 'in', [scopedChapterId, unscopedChapterId])
      .execute()
    await db.deleteFrom('households').where('id', '=', admin.householdId).execute()
    await db.destroy()
  })

  it('rejects an unauthenticated request', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({ request: request('', { concept_id: scopedConceptId, count: 1, bloom: 'Remember', difficulty: 'Easy' }) })
    expect(response.status).toBe(401)
  })

  it('returns 404 for a concept that does not exist', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        concept_id: '00000000-0000-0000-0000-000000000000',
        count: 1,
        bloom: 'Remember',
        difficulty: 'Easy',
      }),
    })
    expect(response.status).toBe(404)
  })

  it('returns 422 when the concept\'s chapter has no IN-scope record', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        concept_id: unscopedConceptId,
        count: 1,
        bloom: 'Remember',
        difficulty: 'Easy',
      }),
    })
    expect(response.status).toBe(422)
  })

  it('falls back to ai_configured:false and generates nothing when no provider key is set', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        concept_id: scopedConceptId,
        count: 2,
        bloom: 'Remember',
        difficulty: 'Easy',
      }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ai_configured).toBe(false)
    expect(body.generated).toEqual([])
  })
})
