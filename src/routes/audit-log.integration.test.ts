import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository, blueprintsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as EvaluationsRoute } from './api/evaluations'
import { Route as EvaluationConfirmRoute } from './api/evaluations/$id/confirm'
import { Route as ConsentWithdrawRoute } from './api/students/$id/consent/withdraw'
import { Route as AuditLogRoute } from './api/audit-log'

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
 * F099: "Append-only log of score overrides, role changes, deletions, admin writes; visible to
 * household owner." Not in tab05's listed routes -- no audit read endpoint exists there --
 * GET /api/audit-log is a new top-level resource. Covers the two write paths this feature wired
 * up (evaluation confirm, consent withdrawal); PATCH /api/evaluations/:id/items/:itemId already
 * wrote audit entries before this feature (F047).
 */
describe('audit log (F099)', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let studentA: TestSession
  let studentAId: string
  let evaluationId: string
  let blueprintId: string
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('audit-a')
    parentB = await createParentSession('audit-b')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parentA.cookie, {
        name: 'Audit Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentAId = (await studentResponse.json()).id
    studentA = await createStudentSession(
      'audit-student',
      parentA.householdId,
      studentAId,
    )

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
      code: `C7M-1.AUDIT-${Date.now()}`,
      name: 'Audit fixture concept',
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
      text: 'Audit fixture question',
      answer: '1',
      created_by: 'audit-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Audit fixture blueprint',
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

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(studentA.cookie, {
        paper_id: generated.paper.id,
        mode: 'online',
      }),
    })
    const attemptId = (await attemptResponse.json()).id
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(studentA.cookie, { confirm_blanks: true }),
      params: { id: attemptId },
    })
    const evalResponse = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parentA.cookie, { attempt_id: attemptId }),
    })
    const evaluation = await evalResponse.json()
    evaluationId = evaluation.evaluation.id
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parentA.cookie, {}),
      params: { id: evaluationId },
    })
    await handlerFor(
      ConsentWithdrawRoute,
      'POST',
    )({
      request: request(parentA.cookie, {}),
      params: { id: studentAId },
    })
  })

  afterAll(async () => {
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', '=', evaluationId)
      .execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db
      .deleteFrom('attempt_answers')
      .where(
        'attempt_id',
        'in',
        db
          .selectFrom('attempts')
          .select('id')
          .where('student_id', '=', studentAId),
      )
      .execute()
    await db
      .deleteFrom('attempts')
      .where('student_id', '=', studentAId)
      .execute()
    await db
      .deleteFrom('paper_questions')
      .where(
        'paper_id',
        'in',
        db
          .selectFrom('papers')
          .select('id')
          .where('student_id', '=', studentAId),
      )
      .execute()
    await db.deleteFrom('papers').where('student_id', '=', studentAId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'audit-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('GET /api/audit-log shows the evaluation confirm and consent withdrawal entries', async () => {
    const response = await handlerFor(
      AuditLogRoute,
      'GET',
    )({
      request: request(parentA.cookie),
    })
    expect(response.status).toBe(200)
    const entries: Array<{ action: string; entity_id: string }> =
      await response.json()

    expect(
      entries.some(
        (e) =>
          e.action === 'evaluation.confirmed' && e.entity_id === evaluationId,
      ),
    ).toBe(true)
    expect(entries.some((e) => e.action === 'consent.withdrawn')).toBe(true)
  })

  it('another household sees none of this household’s entries', async () => {
    const response = await handlerFor(
      AuditLogRoute,
      'GET',
    )({
      request: request(parentB.cookie),
    })
    expect(response.status).toBe(200)
    const entries: Array<{ entity_id: string }> = await response.json()
    expect(entries.some((e) => e.entity_id === evaluationId)).toBe(false)
  })
})
