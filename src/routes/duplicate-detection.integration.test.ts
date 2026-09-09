import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository } from '../db/repositories'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as QuestionsRoute } from './api/questions'

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
 * F023 (exact-hash half only -- the embedding-similarity half needs an AI provider that isn't
 * configured): "warns with a link to the existing question" means the save still succeeds, it
 * just carries a duplicate_of pointer, so this asserts both -- a 201, and a populated pointer.
 */
describe('exact-hash duplicate detection (F023)', () => {
  let db: Db
  let admin: TestSession
  let conceptId: string
  let otherConceptId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('dup-admin')
    await promoteToAdmin(admin.userId)

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

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.DUP-${Date.now()}`,
      name: 'Duplicate detection fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    const otherConcept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.DUP2-${Date.now()}`,
      name: 'Duplicate detection fixture concept 2',
      difficulty_base: 'Easy',
    })
    otherConceptId = otherConcept.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('questions')
      .where('concept_id', 'in', [conceptId, otherConceptId])
      .execute()
    await db
      .deleteFrom('concepts')
      .where('id', 'in', [conceptId, otherConceptId])
      .execute()
    await db
      .deleteFrom('households')
      .where('id', '=', admin.householdId)
      .execute()
    await db.destroy()
  })

  it('a brand-new question has no duplicate_of', async () => {
    const response = await handlerFor(
      QuestionsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        concept_id: conceptId,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'fill_blank',
        text: 'What is 7 + 5?',
        answer: '12',
      }),
    })
    expect(response.status).toBe(201)
    const question = await response.json()
    expect(question.duplicate_of).toBeNull()
  })

  it('the same text (different case/spacing) in the same concept is flagged, not blocked', async () => {
    const response = await handlerFor(
      QuestionsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        concept_id: conceptId,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'fill_blank',
        text: '  WHAT IS 7 + 5?  ',
        answer: '12',
      }),
    })
    expect(response.status).toBe(201)
    const question = await response.json()
    expect(question.duplicate_of).not.toBeNull()
    expect(question.duplicate_of.text).toBe('What is 7 + 5?')
  })

  it('the same text under a different concept is not flagged', async () => {
    const response = await handlerFor(
      QuestionsRoute,
      'POST',
    )({
      request: request(admin.cookie, {
        concept_id: otherConceptId,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'fill_blank',
        text: 'What is 7 + 5?',
        answer: '12',
      }),
    })
    expect(response.status).toBe(201)
    const question = await response.json()
    expect(question.duplicate_of).toBeNull()
  })
})
