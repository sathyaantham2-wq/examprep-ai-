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
import { Route as AttemptAnswerRoute } from './api/attempts/$id/answer'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as EvaluationsRoute } from './api/evaluations'
import { Route as EvaluationConfirmRoute } from './api/evaluations/$id/confirm'
import { Route as TrackerRoute } from './api/tracker/$studentId'

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
 * F064: the screen at /tracker/:studentId reads this data shape -- covers the two fields added
 * for it (subject_name, last_tested_date, src/db/repositories/tracking.ts) that had no prior
 * test coverage, plus the pre-existing status filter.
 *
 * Creates its own concept+question (the pool generatePaper() draws from is otherwise empty --
 * MATH-SEED's chapters hold no permanent questions of their own; every fixture in this codebase
 * populates and cleans up its own) but still resolves the concept actually used from the
 * generated paper's own question rather than assuming it, as defense in depth: this chapter is
 * shared by every test file that touches MATH-SEED chapter 1, so a stray leftover concept from
 * a crashed run elsewhere could in principle still coexist and win the 40/40/20 draw (F028) over
 * this fixture's own single question.
 */
describe('concept tracker data (F064)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let conceptId: string
  let questionId: string
  let usedConceptId: string
  let blueprintId: string
  let paperId: string
  let attemptId: string
  let evaluationId: string
  const today = new Date().toISOString().slice(0, 10)

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('tracker')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Tracker Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'tracker-student',
      parent.householdId,
      studentId,
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
      code: `C7M-1.TRACKER-${Date.now()}`,
      name: 'Tracker fixture concept',
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
      text: 'Tracker fixture question',
      answer: '1',
      created_by: 'tracker-fixture',
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
      name: 'Tracker fixture blueprint',
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 1,
          count: 1,
          bloom_allowed: ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'],
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
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
        // F026's recent-usage exclusion window has no reason to matter to this test (a single
        // freshly-created question has never been served before) -- disabled defensively so a
        // shortfall here can only ever mean "no question exists", never "excluded as a repeat".
        recent_usage_window_days: 0,
      }),
    })
    const generated = await generateResponse.json()
    if (generateResponse.status !== 201 || !generated.paperQuestions?.length) {
      throw new Error(`paper generation failed: ${JSON.stringify(generated)}`)
    }
    paperId = generated.paper.id
    const paperQuestion = generated.paperQuestions[0]

    const questionRow = await db
      .selectFrom('questions')
      .select('concept_id')
      .where('id', '=', paperQuestion.question_id)
      .executeTakeFirstOrThrow()
    usedConceptId = questionRow.concept_id

    const detail = await db
      .selectFrom('questions')
      .selectAll()
      .where('id', '=', paperQuestion.question_id)
      .executeTakeFirstOrThrow()
    const options =
      detail.type === 'mcq'
        ? await db
            .selectFrom('question_options')
            .selectAll()
            .where('question_id', '=', detail.id)
            .execute()
        : []
    const correctOption = options.find((o) => o.is_correct)

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, { paper_id: paperId, mode: 'online' }),
    })
    attemptId = (await attemptResponse.json()).id
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: paperQuestion.id,
        ...(correctOption
          ? { selected_option: correctOption.label }
          : { response_text: detail.answer }),
      }),
      params: { id: attemptId },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({ request: request(student.cookie, {}), params: { id: attemptId } })

    const evalResponse = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({ request: request(parent.cookie, { attempt_id: attemptId }) })
    const evalBody = await evalResponse.json()
    if (evalResponse.status !== 201 && evalResponse.status !== 200) {
      throw new Error(`create evaluation failed: ${JSON.stringify(evalBody)}`)
    }
    evaluationId = evalBody.evaluation.id
    const confirmResponse = await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({ request: request(parent.cookie, {}), params: { id: evaluationId } })
    if (confirmResponse.status !== 200) {
      const confirmBody = await confirmResponse.json().catch(() => ({}))
      throw new Error(`confirm evaluation failed: ${JSON.stringify(confirmBody)}`)
    }
  })

  afterAll(async () => {
    // Scoped by student_id, not usedConceptId -- this brand-new student can only have
    // concept_mastery/concept_status rows from this fixture's own single evaluation. usedConceptId
    // should always equal this fixture's own conceptId (the pool has nothing else in it), but the
    // cleanup below only ever removes this fixture's own concept/question regardless.
    await db
      .deleteFrom('concept_mastery')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('concept_status')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', '=', evaluationId)
      .execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', '=', attemptId)
      .execute()
    await db.deleteFrom('attempts').where('id', '=', attemptId).execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', '=', paperId)
      .execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('includes subject_name and last_tested_date after a confirmed evaluation', async () => {
    const response = await handlerFor(
      TrackerRoute,
      'GET',
    )({
      request: getRequest('http://localhost/test', parent.cookie),
      params: { studentId },
    })
    expect(response.status).toBe(200)
    const rows: Array<{
      concept_id: string
      subject_name: string
      last_tested_date: string | null
      status: string
    }> = await response.json()
    const mine = rows.find((r) => r.concept_id === usedConceptId)
    expect(mine).toBeDefined()
    expect(mine!.subject_name).toBe('Mathematics (seed)')
    expect(mine!.last_tested_date).toBe(today)
  })

  it('the status filter only returns rows matching that status', async () => {
    const allResponse = await handlerFor(
      TrackerRoute,
      'GET',
    )({
      request: getRequest('http://localhost/test', parent.cookie),
      params: { studentId },
    })
    const all: Array<{ concept_id: string; status: string }> =
      await allResponse.json()
    const mine = all.find((r) => r.concept_id === usedConceptId)!

    const filteredResponse = await handlerFor(
      TrackerRoute,
      'GET',
    )({
      request: getRequest(
        `http://localhost/test?status=${encodeURIComponent(mine.status)}`,
        parent.cookie,
      ),
      params: { studentId },
    })
    const filtered: Array<{ concept_id: string; status: string }> =
      await filteredResponse.json()
    expect(filtered.some((r) => r.concept_id === usedConceptId)).toBe(true)
    expect(filtered.every((r) => r.status === mine.status)).toBe(true)
  })
})
