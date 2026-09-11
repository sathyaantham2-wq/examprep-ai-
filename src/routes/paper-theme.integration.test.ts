import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as PdfRoute } from './api/papers/$id/pdf'

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
 * F034/F120: "Themes are data-driven packs ... Ship three: Manga, Doodle Journal, Clean School
 * ... print legibly in black and white." Drives the real generate -> PDF pipeline for the theme
 * packs, plus the PDF route's own ?theme= override and its graceful (never 400) fallback for a
 * garbage or retired value.
 */
describe('paper theme selection (F034/F120)', () => {
  let db: Db
  let parent: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let questionId: string
  const paperIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('theme')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Theme Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id

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
      code: `C7M-1.THEME-${Date.now()}`,
      name: 'Theme fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    const question = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Theme fixture question',
      answer: '1',
      created_by: 'theme-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    questionId = question.id

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Theme fixture blueprint',
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
  })

  afterAll(async () => {
    if (paperIds.length > 0) {
      await db
        .deleteFrom('paper_questions')
        .where('paper_id', 'in', paperIds)
        .execute()
      await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    }
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('rejects an unrecognised theme at generation time', async () => {
    const chapter = await db
      .selectFrom('concepts')
      .select('chapter_id')
      .where('id', '=', conceptId)
      .executeTakeFirstOrThrow()
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.chapter_id],
        theme: 'Diary of a Wimpy Kid',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('generates a paper with the Doodle Journal theme selected', async () => {
    const chapter = await db
      .selectFrom('concepts')
      .select('chapter_id')
      .where('id', '=', conceptId)
      .executeTakeFirstOrThrow()
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.chapter_id],
        theme: 'Doodle Journal',
        recent_usage_window_days: 0,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    paperIds.push(body.paper.id)
    expect(body.paper.theme).toBe('Doodle Journal')
  })

  it('the PDF fetched with no override uses the theme stored at generation', async () => {
    const response = await handlerFor(
      PdfRoute,
      'GET',
    )({ request: request(parent.cookie), params: { id: paperIds[0] } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1000)
  })

  it('a ?theme= query override renders in a different theme than the one stored', async () => {
    const cleanSchoolResponse = await handlerFor(
      PdfRoute,
      'GET',
    )({
      request: new Request('http://localhost/test?theme=Clean%20School', {
        headers: { cookie: parent.cookie },
      }),
      params: { id: paperIds[0] },
    })
    expect(cleanSchoolResponse.status).toBe(200)
    const doodleResponse = await handlerFor(
      PdfRoute,
      'GET',
    )({ request: request(parent.cookie), params: { id: paperIds[0] } })
    const cleanSchoolBytes = (await cleanSchoolResponse.arrayBuffer()).byteLength
    const doodleBytes = (await doodleResponse.arrayBuffer()).byteLength
    // Not a claim about which is bigger, just that a different theme actually produced a
    // different rendered document -- a same-size coincidence would be surprising but not
    // impossible, so this is a light signal, not the primary proof (theme-pdf.integration.test.ts
    // and paper-template.test.ts cover the real assertions).
    expect(cleanSchoolBytes).not.toBe(doodleBytes)
  })

  it('an unrecognised ?theme= value falls back gracefully instead of erroring', async () => {
    const response = await handlerFor(
      PdfRoute,
      'GET',
    )({
      request: new Request('http://localhost/test?theme=Nonsense', {
        headers: { cookie: parent.cookie },
      }),
      params: { id: paperIds[0] },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
  })

  it("F120's retired 'Plain' name falls back gracefully too, same as any other unrecognised value", async () => {
    const response = await handlerFor(
      PdfRoute,
      'GET',
    )({
      request: new Request('http://localhost/test?theme=Plain', {
        headers: { cookie: parent.cookie },
      }),
      params: { id: paperIds[0] },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
  })

  it('generates and renders a paper with the Manga theme selected', async () => {
    const chapter = await db
      .selectFrom('concepts')
      .select('chapter_id')
      .where('id', '=', conceptId)
      .executeTakeFirstOrThrow()
    const generateResponse = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.chapter_id],
        theme: 'Manga',
        recent_usage_window_days: 0,
      }),
    })
    expect(generateResponse.status).toBe(201)
    const generated = await generateResponse.json()
    paperIds.push(generated.paper.id)
    expect(generated.paper.theme).toBe('Manga')

    const pdfResponse = await handlerFor(
      PdfRoute,
      'GET',
    )({ request: request(parent.cookie), params: { id: generated.paper.id } })
    expect(pdfResponse.status).toBe(200)
    const bytes = new Uint8Array(await pdfResponse.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1000)
  })
})
