import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository } from '../db/repositories'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as ConceptByIdRoute } from './api/syllabus/concepts/$id'

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
    method: 'PATCH',
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F124: PATCH /api/syllabus/concepts/:id -- concepts' first-ever PATCH route, scoped to just the
 * curated-video pair (video_url/video_title). Admin-only, matching every other content-authoring
 * route (questions, blueprints, syllabus tree).
 */
describe('concept video link (F124)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('concept-video-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('concept-video-parent')

    const chapter = await db
      .selectFrom('chapters')
      .innerJoin('subjects', 'subjects.id', 'chapters.subject_id')
      .select('chapters.id')
      .where('subjects.code', '=', 'MATH-SEED')
      .where('chapters.chapter_no', '=', 1)
      .executeTakeFirstOrThrow()

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.VIDEOLINK-${Date.now()}`,
      name: 'Video link fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('rejects a non-admin', async () => {
    const response = await handlerFor(
      ConceptByIdRoute,
      'PATCH',
    )({
      request: request(parent.cookie, { video_url: 'https://youtube.com/watch?v=abc' }),
      params: { id: conceptId },
    })
    expect(response.status).toBe(403)
  })

  it('rejects an invalid URL', async () => {
    const response = await handlerFor(
      ConceptByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, { video_url: 'not-a-url' }),
      params: { id: conceptId },
    })
    expect(response.status).toBe(400)
  })

  it('404s an unknown concept id', async () => {
    const response = await handlerFor(
      ConceptByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, {
        video_url: 'https://www.youtube.com/watch?v=abc123',
      }),
      params: { id: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.status).toBe(404)
  })

  it('an admin can set, then clear, the video link', async () => {
    const setResponse = await handlerFor(
      ConceptByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, {
        video_url: 'https://www.youtube.com/watch?v=abc123',
        video_title: 'A concept video',
      }),
      params: { id: conceptId },
    })
    expect(setResponse.status).toBe(200)
    const setBody = await setResponse.json()
    expect(setBody.video_url).toBe('https://www.youtube.com/watch?v=abc123')
    expect(setBody.video_title).toBe('A concept video')

    const clearResponse = await handlerFor(
      ConceptByIdRoute,
      'PATCH',
    )({
      request: request(admin.cookie, { video_url: null, video_title: null }),
      params: { id: conceptId },
    })
    expect(clearResponse.status).toBe(200)
    const clearBody = await clearResponse.json()
    expect(clearBody.video_url).toBeNull()
    expect(clearBody.video_title).toBeNull()
  })
})
