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
import { Route as AttemptByIdRoute } from './api/attempts/$id'
import { Route as AttemptAnswerRoute } from './api/attempts/$id/answer'

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
    method: body !== undefined ? 'POST' : 'GET',
    headers: {
      cookie,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * The test runner (M08) reads GET /api/attempts/:id to render questions and resume saved answers.
 * T09's hard rule -- a student can never see or download an answer key -- is genuinely load
 * -bearing here: the underlying repositories select questions.answer and option.is_correct for
 * grading elsewhere, so this proves the handler's own narrow projection actually keeps both out of
 * the wire response rather than just trusting the code review.
 */
describe('GET /api/attempts/:id never leaks the answer key (T09)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let attemptId: string
  let paperId: string
  // Deliberately distinct from every option's text -- an MCQ's correct option text is meant to
  // be visible to the student (it's a choice they can pick), so the real leak this test guards
  // against is the separate `questions.answer` DB column, not "the correct-looking option".
  const ANSWER_FIELD_MARKER = 'ANSWER-FIELD-SHOULD-NEVER-LEAK-77219'

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('attemptdetail')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Attempt Detail Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'attemptdetail-student',
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
      code: `C7M-1.ATTEMPTDETAIL-${Date.now()}`,
      name: 'Attempt detail fixture concept',
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
      text: 'Pick the marked option.',
      answer: ANSWER_FIELD_MARKER,
      created_by: 'attemptdetail-fixture',
      options: [
        { label: 'A', text: 'wrong one', is_correct: false, order_index: 1 },
        {
          label: 'B',
          text: 'right one',
          is_correct: true,
          order_index: 2,
        },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Attempt detail fixture blueprint',
      duration_min: 15,
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
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      }),
    })
    const generated = await generateResponse.json()
    paperId = generated.paper.id

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, {
        paper_id: paperId,
        mode: 'online',
      }),
    })
    attemptId = (await attemptResponse.json()).id
  })

  afterAll(async () => {
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
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'attemptdetail-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('returns questions and options with no answer key anywhere in the payload', async () => {
    const response = await handlerFor(
      AttemptByIdRoute,
      'GET',
    )({
      request: request(student.cookie),
      params: { id: attemptId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()

    // The literal questions.answer value must never appear anywhere in the response.
    expect(JSON.stringify(body)).not.toContain(ANSWER_FIELD_MARKER)

    expect(body.questions).toHaveLength(1)
    for (const q of body.questions) {
      expect(q).not.toHaveProperty('answer')
      for (const option of q.options) {
        expect(option).not.toHaveProperty('is_correct')
        expect(Object.keys(option).sort()).toEqual(['label', 'text'])
      }
    }
  })

  it('reflects a saved answer on resume', async () => {
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: (
          await db
            .selectFrom('paper_questions')
            .select('id')
            .where('paper_id', '=', paperId)
            .executeTakeFirstOrThrow()
        ).id,
        selected_option: 'B',
      }),
      params: { id: attemptId },
    })

    const response = await handlerFor(
      AttemptByIdRoute,
      'GET',
    )({
      request: request(student.cookie),
      params: { id: attemptId },
    })
    const body = await response.json()
    expect(body.questions[0].saved_answer).toEqual({
      response_text: null,
      selected_option: 'B',
    })
  })

  it('another student cannot view this attempt', async () => {
    const otherParent = await createParentSession('attemptdetail-other')
    const otherStudentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(otherParent.cookie, {
        name: 'Other Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    const otherStudentId = (await otherStudentResponse.json()).id
    const otherStudent = await createStudentSession(
      'attemptdetail-other-student',
      otherParent.householdId,
      otherStudentId,
    )

    const response = await handlerFor(
      AttemptByIdRoute,
      'GET',
    )({
      request: request(otherStudent.cookie),
      params: { id: attemptId },
    })
    expect(response.status).toBe(404)

    await db
      .deleteFrom('households')
      .where('id', '=', otherParent.householdId)
      .execute()
  })

  it('a parent session (not a student) gets 403', async () => {
    const response = await handlerFor(
      AttemptByIdRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { id: attemptId },
    })
    expect(response.status).toBe(403)
  })
})
