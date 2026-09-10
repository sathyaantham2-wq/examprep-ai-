import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as QuestionByIdRoute } from './api/questions/$id'
import { Route as RejectRoute } from './api/questions/$id/reject'
import { Route as ApproveRoute } from './api/questions/$id/approve'
import { Route as ConceptsRoute } from './api/syllabus/concepts'

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
    method: body ? 'POST' : 'GET',
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F084: the admin review queue's supporting API -- full question detail (including the answer
 * key, legitimate here since an admin reviewing a question IS the answer-key audience), reject
 * (always requires a reason, unlike approve which only requires one for Tier B), and the concept
 * picker used by both the review queue and the AI-generate form.
 */
describe('admin question review (F084)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let conceptId: string
  let chapterId: string
  let tierBQuestionId: string
  let tierAQuestionId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('review-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('review-parent')

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
      code: `C7M-1.REVIEW-${Date.now()}`,
      name: 'Review fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // Tier B: a long-answer question, always needs full review regardless of correctness shape.
    const tierB = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Apply',
      difficulty: 'Hard',
      marks: 3,
      type: 'long_answer',
      text: 'Review fixture Tier B question',
      answer: 'A long expected answer',
      created_by: 'review-fixture',
    })
    tierBQuestionId = tierB.id

    // Tier A: objective, <=2 marks, English, no diagram -- auto-approved by createQuestion, so
    // reusing it here as an already-approved question to confirm reject still works on it too.
    const tierA = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Review fixture Tier A question',
      answer: '4',
      created_by: 'review-fixture',
      options: [
        { label: 'A', text: '4', is_correct: true, order_index: 1 },
        { label: 'B', text: '5', is_correct: false, order_index: 2 },
      ],
    })
    tierAQuestionId = tierA.id
  })

  afterAll(async () => {
    await db.deleteFrom('households').where('id', 'in', [admin.householdId, parent.householdId]).execute()
    await db.deleteFrom('questions').where('created_by', '=', 'review-fixture').execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('GET question detail requires admin', async () => {
    const response = await handlerFor(QuestionByIdRoute, 'GET')({
      request: request(parent.cookie),
      params: { id: tierAQuestionId },
    })
    expect(response.status).toBe(403)
  })

  it('GET question detail includes options for an admin', async () => {
    const response = await handlerFor(QuestionByIdRoute, 'GET')({
      request: request(admin.cookie),
      params: { id: tierAQuestionId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.options).toHaveLength(2)
    expect(body.options.some((o: { is_correct: boolean }) => o.is_correct)).toBe(true)
  })

  it('rejecting without a reason is rejected', async () => {
    const response = await handlerFor(RejectRoute, 'POST')({
      request: request(admin.cookie, {}),
      params: { id: tierBQuestionId },
    })
    expect(response.status).toBe(400)
  })

  it('rejecting with a reason retires the question and records the reviewer', async () => {
    const response = await handlerFor(RejectRoute, 'POST')({
      request: request(admin.cookie, { note: 'Ambiguous wording' }),
      params: { id: tierBQuestionId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('retired')
    expect(body.review_note).toBe('Ambiguous wording')
    expect(body.reviewed_by).toBe(admin.userId)
  })

  it('re-approving an already-approved Tier A question succeeds', async () => {
    const response = await handlerFor(ApproveRoute, 'POST')({
      request: request(admin.cookie, {}),
      params: { id: tierAQuestionId },
    })
    expect(response.status).toBe(200)
  })

  it('lists concepts by chapter and by subject', async () => {
    const responseByChapter = await handlerFor(
      ConceptsRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?chapter_id=${chapterId}`, {
        headers: { cookie: admin.cookie },
      }),
    })
    expect(responseByChapter.status).toBe(200)
    const chapterConcepts = await responseByChapter.json()
    expect(chapterConcepts.some((c: { id: string }) => c.id === conceptId)).toBe(true)

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const responseBySubject = await handlerFor(
      ConceptsRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?subject_id=${subject.id}`, {
        headers: { cookie: admin.cookie },
      }),
    })
    expect(responseBySubject.status).toBe(200)
    const subjectConcepts = await responseBySubject.json()
    expect(subjectConcepts.some((c: { id: string }) => c.id === conceptId)).toBe(true)
  })

  it('rejects a request naming both chapter_id and subject_id', async () => {
    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const response = await handlerFor(
      ConceptsRoute,
      'GET',
    )({
      request: new Request(
        `http://localhost/test?chapter_id=${chapterId}&subject_id=${subject.id}`,
        { headers: { cookie: admin.cookie } },
      ),
    })
    expect(response.status).toBe(400)
  })
})
