import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { blueprintsRepository, conceptsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { transcribePage } from '../lib/ai-transcription'
import { purgeExpiredScans } from '../lib/scans'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as ScanRoute } from './api/attempts/$id/scan'
import { Route as ScanPagesRoute } from './api/attempts/$id/scan/pages'
import { Route as ScanPageRoute } from './api/attempts/$id/scan/pages/$pageId'
import { Route as ExtractRoute } from './api/attempts/$id/scan/pages/$pageId/extract'
import { Route as DetectionRoute } from './api/attempts/$id/scan/detections/$detectionId'
import { Route as ApplyRoute } from './api/attempts/$id/scan/apply'
import { Route as ScanImageRoute } from './api/scan-pages/$pageId'
import { Route as ScanAttemptRoute } from './api/papers/$id/scan-attempt'

// Only the vision call is faked; everything else is the real route, service and database.
vi.mock('../lib/ai-transcription', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../lib/ai-transcription')),
  transcribePage: vi.fn(),
}))
vi.mock('../lib/ai-provider', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../lib/ai-provider')),
  isAiConfigured: () => true,
}))

type RouteHandler = (opts: { request: Request; params?: Record<string, string> }) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  return (route.options.server as { handlers: Record<string, RouteHandler> }).handlers[method]
}

function req(cookie: string, method = 'GET', body?: unknown, url = 'http://localhost/test'): Request {
  return new Request(url, {
    method,
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// Not a real JPEG -- the server never decodes images, it only stores, encrypts and serves them.
const PAGE_BYTES = Buffer.from('fake-jpeg-page-'.repeat(20))
const PAGE_B64 = PAGE_BYTES.toString('base64')
const TAG = `f050-${Date.now()}`

describe('F050-F053 + F097: written paper photographed, read, checked and marked', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentA: TestSession
  let studentB: TestSession
  let paperId: string
  let attemptId: string
  let conceptId: string
  let blueprintId: string
  let mcqSlot: string
  let shortSlot: string
  let orSlots: Array<string>
  let pageId: string

  const scanState = async (cookie: string) => {
    const res = await handlerFor(ScanRoute, 'GET')({ request: req(cookie), params: { id: attemptId } })
    expect(res.status).toBe(200)
    return res.json()
  }

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession(`${TAG}-a`)
    parentB = await createParentSession(`${TAG}-b`)
    const kidA = await handlerFor(StudentsRoute, 'POST')({
      request: req(parentA.cookie, 'POST', { name: 'Scan Kid A', class: 7, board: 'CBSE', consent_accepted: true }),
    })
    const kidB = await handlerFor(StudentsRoute, 'POST')({
      request: req(parentB.cookie, 'POST', { name: 'Scan Kid B', class: 7, board: 'CBSE', consent_accepted: true }),
    })
    const studentAId = (await kidA.json()).id
    const studentBId = (await kidB.json()).id
    studentA = await createStudentSession(`${TAG}-sa`, parentA.householdId, studentAId)
    studentB = await createStudentSession(`${TAG}-sb`, parentB.householdId, studentBId)

    const subject = await db.selectFrom('subjects').selectAll().where('code', '=', 'MATH-SEED').executeTakeFirstOrThrow()
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
      code: `C7M-1.${TAG}`,
      name: 'Scan fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id
    const base = { concept_id: concept.id, board: 'CBSE', class: 7, bloom: 'Remember', difficulty: 'Easy', created_by: TAG } as const
    const mcq = await createQuestion(db, {
      ...base,
      marks: 1,
      type: 'mcq',
      text: 'Scan MCQ',
      answer: '1',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    const short = await createQuestion(db, { ...base, marks: 2, type: 'short_answer', text: 'Solve x + 2 = 7', answer: 'x = 5' })
    const orX = await createQuestion(db, { ...base, marks: 3, type: 'short_answer', text: 'Explain X', answer: 'X' })
    const orY = await createQuestion(db, { ...base, marks: 3, type: 'short_answer', text: 'Explain Y', answer: 'Y' })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: `${TAG} blueprint`,
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([{ name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] }]),
      bloom_targets: JSON.stringify({ Remember: 100, Understand: 0, Apply: 0, Analyse: 0, Evaluate: 0, Create: 0 }),
    })
    blueprintId = blueprint.id
    const generated = await (
      await handlerFor(GenerateRoute, 'POST')({
        request: req(parentA.cookie, 'POST', { student_id: studentAId, blueprint_id: blueprint.id, chapter_ids: [chapter.id] }),
      })
    ).json()
    paperId = generated.paper.id
    // Pin the paper's content so the test doesn't depend on what else the shared test bank holds:
    // Q1 our MCQ, Q2 a written answer, Q3 an OR pair.
    await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
    const inserted = await db
      .insertInto('paper_questions')
      .values([
        { paper_id: paperId, question_id: mcq.id, section: 'A', position: 1, marks: 1 },
        { paper_id: paperId, question_id: short.id, section: 'A', position: 2, marks: 2 },
        { paper_id: paperId, question_id: orX.id, section: 'A', position: 3, marks: 3, choice_group: 'or-3' },
        { paper_id: paperId, question_id: orY.id, section: 'A', position: 3, marks: 3, choice_group: 'or-3' },
      ])
      .returning(['id', 'position'])
      .execute()
    mcqSlot = inserted[0].id
    shortSlot = inserted[1].id
    orSlots = [inserted[2].id, inserted[3].id]

    const attempt = await handlerFor(AttemptsRoute, 'POST')({
      request: req(studentA.cookie, 'POST', { paper_id: paperId, mode: 'online' }),
    })
    attemptId = (await attempt.json()).id
  })

  afterAll(async () => {
    const attemptIds = db.selectFrom('attempts').select('id').where('paper_id', '=', paperId)
    const evaluationIds = db.selectFrom('evaluations').select('id').where('attempt_id', 'in', attemptIds)
    await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', evaluationIds).execute()
    await db.deleteFrom('evaluations').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('attempt_answers').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('scan_detections').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('scan_pages').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('uploads').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('attempts').where('paper_id', '=', paperId).execute()
    await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db.deleteFrom('households').where('id', 'in', [parentA.householdId, parentB.householdId]).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('created_by', '=', TAG).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('F050/F097: a page is stored encrypted, and the attempt becomes an uploaded one', async () => {
    const res = await handlerFor(ScanPagesRoute, 'POST')({
      request: req(studentA.cookie, 'POST', { media_type: 'image/jpeg', image_base64: PAGE_B64 }),
      params: { id: attemptId },
    })
    expect(res.status).toBe(201)
    pageId = (await res.json()).id

    const row = await db.selectFrom('scan_pages').selectAll().where('id', '=', pageId).executeTakeFirstOrThrow()
    expect(row.image).not.toBeNull()
    expect(row.image!.includes(PAGE_BYTES)).toBe(false)
    const upload = await db.selectFrom('uploads').selectAll().where('attempt_id', '=', attemptId).executeTakeFirstOrThrow()
    expect(upload).toMatchObject({ kind: 'scan', page_count: 1, size_bytes: String(PAGE_BYTES.length) })
    expect(upload.storage_ref).not.toMatch(/^https?:/)
    const attempt = await db.selectFrom('attempts').select('mode').where('id', '=', attemptId).executeTakeFirstOrThrow()
    expect(attempt.mode).toBe('uploaded')
  })

  it('F050: rejects anything that is not an image, with a clear message', async () => {
    const res = await handlerFor(ScanPagesRoute, 'POST')({
      request: req(studentA.cookie, 'POST', { media_type: 'application/pdf', image_base64: PAGE_B64 }),
      params: { id: attemptId },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/JPEG, PNG or WebP/)
  })

  it('F097: the image is served only with a valid signature AND a viewer from her household', async () => {
    const state = await scanState(studentA.cookie)
    const url = `http://localhost${state.pages[0].url}`
    const get = (cookie: string, u = url) =>
      handlerFor(ScanImageRoute, 'GET')({ request: req(cookie, 'GET', undefined, u), params: { pageId } })

    const own = await get(studentA.cookie)
    expect(own.status).toBe(200)
    expect(own.headers.get('cache-control')).toContain('no-store')
    expect(Buffer.from(await own.arrayBuffer()).equals(PAGE_BYTES)).toBe(true)
    expect((await get(parentA.cookie)).status).toBe(200)

    expect((await get(studentB.cookie)).status).toBe(404)
    expect((await get(parentB.cookie)).status).toBe(404)
    expect((await get('')).status).toBe(404)
    expect((await get(studentA.cookie, url.replace(/sig=[^&]+/, 'sig=forged'))).status).toBe(404)
    expect((await get(studentA.cookie, `http://localhost/api/scan-pages/${pageId}`)).status).toBe(404)
  })

  it('T09: the review data never carries the answer key', async () => {
    const state = await scanState(studentA.cookie)
    for (const q of state.questions) {
      expect(Object.keys(q)).not.toContain('answer')
      expect(Object.keys(q)).not.toContain('is_correct')
    }
    expect(JSON.stringify(state)).not.toMatch(/is_correct|x = 5/)
  })

  it('F051/F052/F053: readings are mapped, and anything unsure blocks marking', async () => {
    vi.mocked(transcribePage).mockResolvedValue(
      JSON.stringify({
        answers: [
          { question: '1', option: 'b', confidence: 0.97, box: [50, 100, 800, 60] },
          { question: '2', text: 'x = 6', confidence: 0.55, box: [50, 200, 800, 150] },
          { question: '3', text: 'X happens because...', confidence: 0.9, box: [50, 400, 800, 300] },
          { question: '9', text: 'stray writing', confidence: 0.4 },
        ],
      }),
    )
    const res = await handlerFor(ExtractRoute, 'POST')({
      request: req(studentA.cookie, 'POST', {}),
      params: { id: attemptId, pageId },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ found: 4 })
    // The model got the key with the OR pair split, and never the answers.
    const call = vi.mocked(transcribePage).mock.calls[0][1]
    expect(call.key.map((k) => k.key)).toEqual(['1', '2', '3A', '3B'])
    expect(call.key[0].optionLabels).toEqual(['A', 'B'])

    const state = await scanState(studentA.cookie)
    const byLabel = Object.fromEntries(state.detections.map((d: { detected_label: string }) => [d.detected_label, d]))
    expect(byLabel['1']).toMatchObject({ paper_question_id: mcqSlot, selected_option: 'B', status: 'mapped' })
    expect(byLabel['1'].bbox).toEqual({ x: 0.05, y: 0.1, w: 0.8, h: 0.06 })
    expect(byLabel['2']).toMatchObject({ paper_question_id: shortSlot, status: 'mapped', confirmed: false })
    expect(byLabel['3']).toMatchObject({ paper_question_id: null, status: 'unmapped' })
    expect(byLabel['9'].status).toBe('unmapped')
    expect(state.blockers).toEqual({ unmapped: 2, duplicates: 0, unconfirmedLowConfidence: 1, missingPositions: [3] })
    expect(state.can_apply).toBe(false)

    const apply = await handlerFor(ApplyRoute, 'POST')({
      request: req(studentA.cookie, 'POST', { confirm_blanks: true }),
      params: { id: attemptId },
    })
    expect(apply.status).toBe(409)
    expect((await apply.json()).error).toBe('needs_review')
  })

  it('T02: no route in the scan flow works for another household', async () => {
    const state = await scanState(studentA.cookie)
    const detectionId = state.detections[0].id
    for (const cookie of [studentB.cookie, parentB.cookie]) {
      const calls: Array<[RouteHandler, Request, Record<string, string>]> = [
        [handlerFor(ScanRoute, 'GET'), req(cookie), { id: attemptId }],
        [handlerFor(ScanRoute, 'PATCH'), req(cookie, 'PATCH', { page_ids: [pageId] }), { id: attemptId }],
        [handlerFor(ScanPagesRoute, 'POST'), req(cookie, 'POST', { media_type: 'image/jpeg', image_base64: PAGE_B64 }), { id: attemptId }],
        [handlerFor(ScanPageRoute, 'DELETE'), req(cookie, 'DELETE'), { id: attemptId, pageId }],
        [handlerFor(ExtractRoute, 'POST'), req(cookie, 'POST', {}), { id: attemptId, pageId }],
        [handlerFor(DetectionRoute, 'PATCH'), req(cookie, 'PATCH', { action: 'discard' }), { id: attemptId, detectionId }],
        [handlerFor(ApplyRoute, 'POST'), req(cookie, 'POST', {}), { id: attemptId }],
      ]
      for (const [handler, request, params] of calls) {
        expect((await handler({ request, params })).status).toBe(404)
      }
    }
    // ...and none of those calls changed anything.
    const after = await scanState(studentA.cookie)
    expect(after.pages).toHaveLength(1)
    expect(after.detections.find((d: { id: string }) => d.id === detectionId).status).not.toBe('discarded')
  })

  it('F052/F053: the parent settles every reading, then the paper goes for marking', async () => {
    const state = await scanState(parentA.cookie)
    const byLabel = Object.fromEntries(state.detections.map((d: { detected_label: string; id: string }) => [d.detected_label, d.id]))
    const patch = (detectionId: string, body: unknown) =>
      handlerFor(DetectionRoute, 'PATCH')({
        request: req(parentA.cookie, 'PATCH', body),
        params: { id: attemptId, detectionId },
      })

    // An MCQ can only take an option the question printed.
    expect((await patch(byLabel['1'], { action: 'confirm', selected_option: 'Z' })).status).toBe(400)
    // A question from another paper can't be assigned.
    expect((await patch(byLabel['3'], { action: 'confirm', paper_question_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400)

    expect((await patch(byLabel['2'], { action: 'confirm', response_text: 'x = 5' })).status).toBe(204)
    expect((await patch(byLabel['3'], { action: 'confirm', paper_question_id: orSlots[0] })).status).toBe(204)
    expect((await patch(byLabel['9'], { action: 'discard' })).status).toBe(204)

    const settled = await scanState(parentA.cookie)
    expect(settled.blockers).toEqual({ unmapped: 0, duplicates: 0, unconfirmedLowConfidence: 0, missingPositions: [] })
    expect(settled.can_apply).toBe(true)

    const apply = await handlerFor(ApplyRoute, 'POST')({
      request: req(parentA.cookie, 'POST', {}),
      params: { id: attemptId },
    })
    expect(apply.status).toBe(200)
    expect((await apply.json()).status).toBe('submitted')

    const answers = await db
      .selectFrom('attempt_answers')
      .select(['paper_question_id', 'response_text', 'selected_option', 'source', 'image_ref'])
      .where('attempt_id', '=', attemptId)
      .execute()
    const bySlot = Object.fromEntries(answers.map((a) => [a.paper_question_id, a]))
    expect(bySlot[mcqSlot]).toMatchObject({ selected_option: 'B', source: 'ocr', image_ref: `scan_page:${pageId}` })
    expect(bySlot[shortSlot]).toMatchObject({ response_text: 'x = 5', source: 'ocr' })
    expect(bySlot[orSlots[0]]).toMatchObject({ response_text: 'X happens because...', source: 'ocr' })
    expect(bySlot[orSlots[1]]).toBeUndefined()
    expect(answers).toHaveLength(3)
  })

  it('once sent for marking, the scan is read-only', async () => {
    const res = await handlerFor(ScanPagesRoute, 'POST')({
      request: req(studentA.cookie, 'POST', { media_type: 'image/jpeg', image_base64: PAGE_B64 }),
      params: { id: attemptId },
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('attempt_closed')
  })

  it('F097 retention: page images are deleted after 30 days; the answers stay', async () => {
    expect(await purgeExpiredScans(db, new Date())).toBe(0)
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
    expect(await purgeExpiredScans(db, later)).toBeGreaterThanOrEqual(1)

    const row = await db.selectFrom('scan_pages').selectAll().where('id', '=', pageId).executeTakeFirstOrThrow()
    expect(row.image).toBeNull()
    expect(row.purged_at).not.toBeNull()
    const state = await scanState(studentA.cookie)
    expect(state.pages[0]).toMatchObject({ purged: true, url: null })
    const answers = await db.selectFrom('attempt_answers').select('id').where('attempt_id', '=', attemptId).execute()
    expect(answers).toHaveLength(3)
  })

  it('F050: a parent with the printed pages can start an upload attempt; another household cannot', async () => {
    const start = (cookie: string) =>
      handlerFor(ScanAttemptRoute, 'POST')({ request: req(cookie, 'POST', {}), params: { id: paperId } })

    expect((await start(parentB.cookie)).status).toBe(404)
    expect((await start(studentB.cookie)).status).toBe(404)

    const first = await start(parentA.cookie)
    expect(first.status).toBe(200)
    const { attempt_id } = await first.json()
    // The earlier attempt was already sent for marking, so this is a fresh one...
    expect(attempt_id).not.toBe(attemptId)
    const created = await db.selectFrom('attempts').selectAll().where('id', '=', attempt_id).executeTakeFirstOrThrow()
    expect(created).toMatchObject({ mode: 'uploaded', status: 'in_progress', paper_id: paperId })
    // ...and asking again (or the student asking) reuses it rather than piling up attempts.
    expect((await (await start(parentA.cookie)).json()).attempt_id).toBe(attempt_id)
    expect((await (await start(studentA.cookie)).json()).attempt_id).toBe(attempt_id)
  })
})
