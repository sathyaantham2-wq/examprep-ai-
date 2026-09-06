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
import { Route as CoverageRoute } from './api/papers/$id/coverage'

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

// PDF content streams are Flate-compressed, so a page count can't come from a raw text search --
// but Chromium's page.pdf() writes page objects as plain, uncompressed dictionaries ("/Type
// /Page", not "/Type /Pages"), so counting those is a reliable, dependency-free page count.
function countPdfPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1')
  const matches = text.match(/\/Type\s*\/Page(?!s)/g)
  return matches?.length ?? 0
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
 * F033/F035/F036/F037: generates a real PDF through the actual route (headless Chromium via
 * Playwright, see src/lib/pdf/render.ts) against the real dev database, and checks it's a
 * genuine, non-trivial PDF -- not just that the HTML template functions return a string. Also
 * covers F096/T02 for the two new household-scoped routes this feature added.
 */
describe('paper PDF and coverage routes (F033/F035/F036/F037)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentAId: string
  let paperId: string
  let blueprintId: string
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('pdf-a')
    parentB = await createParentSession('pdf-b')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'PDF Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentResponse.json()).id

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
      code: `C7M-1.PDF-${Date.now()}`,
      name: 'PDF fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // One mcq (with 4 options, so the key can show a real correct-option letter) and one
    // short_answer question with a diagram, so the template's branches beyond the bare minimum
    // (options list, ruled answer lines, draw-here box, step marks) all actually render.
    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'What is 2 + 2?',
      answer: '4',
      created_by: 'pdf-fixture',
      options: [
        { label: 'A', text: '3', is_correct: false, order_index: 1 },
        { label: 'B', text: '4', is_correct: true, order_index: 2 },
        { label: 'C', text: '5', is_correct: false, order_index: 3 },
        { label: 'D', text: '6', is_correct: false, order_index: 4 },
      ],
    })
    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Apply',
      difficulty: 'Hard',
      marks: 3,
      type: 'short_answer',
      text: 'Draw and label a right triangle with legs 3cm and 4cm; find the hypotenuse.',
      answer: '5 cm, by the Pythagorean theorem.',
      diagram_kind: 'right-triangle',
      created_by: 'pdf-fixture',
      step_marks: [
        {
          step_no: 1,
          description: 'Correct diagram with labelled sides',
          marks: 1,
        },
        {
          step_no: 2,
          description: 'Applies Pythagorean theorem correctly',
          marks: 1,
        },
        { step_no: 3, description: 'Correct final answer with unit', marks: 1 },
      ],
    })
    // computeReviewTier (F117) puts anything >=3 marks in Tier B (draft, pending review) -- there
    // is no review-queue UI yet (F084), so approve it directly the same way earlier fixtures in
    // this session have stood in for that missing step.
    await db
      .updateTable('questions')
      .set({ status: 'approved' })
      .where('created_by', '=', 'pdf-fixture')
      .where('status', '=', 'draft')
      .execute()

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'PDF fixture blueprint',
      duration_min: 30,
      total_marks: 4,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 1,
          count: 1,
          bloom_allowed: ['Remember'],
        },
        {
          name: 'Section B',
          marks_per_question: 3,
          count: 1,
          bloom_allowed: ['Apply'],
        },
      ]),
      bloom_targets: JSON.stringify({
        Remember: 25,
        Understand: 0,
        Apply: 75,
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
      .deleteFrom('paper_questions')
      .where('paper_id', '=', paperId)
      .execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'pdf-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('GET /api/papers/:id/pdf returns a real, non-trivial PDF (student paper only)', async () => {
    const response = await handlerFor(
      PdfRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: paperId },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')

    const bytes = new Uint8Array(await response.arrayBuffer())
    const header = Buffer.from(bytes.slice(0, 5)).toString('ascii')
    expect(header).toBe('%PDF-')
    // A genuinely rendered A4 page with a header + 2 questions is comfortably more than a few KB;
    // an empty/broken render would be a few hundred bytes at most.
    expect(bytes.byteLength).toBeGreaterThan(5000)

    // This short paper (2 questions) fits on a single A4 page with no key appended.
    expect(countPdfPages(bytes)).toBe(1)
  })

  it('GET /api/papers/:id/pdf?include_key=true returns a larger PDF that does include the key', async () => {
    const withoutKey = await handlerFor(
      PdfRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: paperId },
    })
    const withoutKeyBytes = await withoutKey.arrayBuffer()

    const withKeyResponse = await handlerFor(
      PdfRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?include_key=true`, {
        headers: { cookie: parentA.cookie },
      }),
      params: { id: paperId },
    })
    expect(withKeyResponse.status).toBe(200)
    const withKeyBytes = await withKeyResponse.arrayBuffer()

    expect(withKeyBytes.byteLength).toBeGreaterThan(withoutKeyBytes.byteLength)
    // The key is appended behind an explicit page-break-before, so include_key=true must produce
    // strictly more pages than the key-less document -- a real proxy for "the key actually
    // rendered", since PDF content streams are Flate-compressed and not text-greppable.
    expect(countPdfPages(new Uint8Array(withKeyBytes))).toBeGreaterThan(
      countPdfPages(new Uint8Array(withoutKeyBytes)),
    )
  })

  it('GET /api/papers/:id/coverage returns the concept coverage table (F037)', async () => {
    const response = await handlerFor(
      CoverageRoute,
      'GET',
    )({
      request: request(parentA.cookie),
      params: { id: paperId },
    })
    expect(response.status).toBe(200)
    const coverage = await response.json()
    expect(coverage).toHaveLength(1)
    expect(coverage[0]).toMatchObject({
      concept_id: conceptId,
      concept_name: 'PDF fixture concept',
      question_count: 2,
      marks: 4,
      weight_pct: 100,
    })
    expect(coverage[0].bloom_split).toEqual({ Remember: 1, Apply: 1 })
  })

  it('F096: another household gets 404 on both new routes', async () => {
    const pdfResponse = await handlerFor(
      PdfRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { id: paperId },
    })
    expect(pdfResponse.status).toBe(404)

    const coverageResponse = await handlerFor(
      CoverageRoute,
      'GET',
    )({
      request: request(parentB.cookie),
      params: { id: paperId },
    })
    expect(coverageResponse.status).toBe(404)
  })
})
