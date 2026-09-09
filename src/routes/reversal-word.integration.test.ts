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
import { Route as EvaluationReportRoute } from './api/evaluations/$id/report'

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
 * F060: "Reversal-word questions (NOT/least/false) tagged; wrong answers on them classified as
 * reading discipline, routed to a drill instead of re-teaching." Runs two real full generate ->
 * attempt -> submit -> evaluate -> confirm cycles side by side -- one on a question tagged
 * is_reversal_word, one on an otherwise-identical question that isn't -- both answered wrong, so
 * the only variable is the tag, proving the classification (not something else) causes the
 * difference.
 */
describe('reversal-word reading-discipline classification (F060)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  const evaluationIds: Array<string> = []
  const attemptIds: Array<string> = []
  const paperIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('reversal')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Reversal Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'reversal-student',
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
      code: `C7M-1.REVERSAL-${Date.now()}`,
      name: 'Reversal fixture concept',
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
      text: 'Which of these is NOT a prime number?',
      answer: '4',
      is_reversal_word: true,
      created_by: 'reversal-fixture',
      options: [
        { label: 'A', text: '2', is_correct: false, order_index: 1 },
        { label: 'B', text: '4', is_correct: true, order_index: 2 },
      ],
    })
    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Which of these is a prime number?',
      answer: '2',
      is_reversal_word: false,
      created_by: 'reversal-fixture',
      options: [
        { label: 'A', text: '2', is_correct: true, order_index: 1 },
        { label: 'B', text: '4', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Reversal fixture blueprint',
      duration_min: 10,
      total_marks: 2,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 1,
          count: 2,
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
    paperIds.push(generated.paper.id)

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, {
        paper_id: generated.paper.id,
        mode: 'online',
      }),
    })
    const attemptId = (await attemptResponse.json()).id
    attemptIds.push(attemptId)

    // Wrong on both, on purpose -- picks whichever option is NOT the marked-correct one.
    for (const pq of generated.paperQuestions) {
      const question = await db
        .selectFrom('questions')
        .selectAll()
        .where('id', '=', pq.question_id)
        .executeTakeFirstOrThrow()
      const options = await db
        .selectFrom('question_options')
        .selectAll()
        .where('question_id', '=', question.id)
        .execute()
      const wrongOption = options.find((o) => !o.is_correct)!
      await handlerFor(
        AttemptAnswerRoute,
        'PATCH',
      )({
        request: request(student.cookie, {
          paper_question_id: pq.id,
          selected_option: wrongOption.label,
        }),
        params: { id: attemptId },
      })
    }

    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: attemptId },
    })
    const evalResponse = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parent.cookie, { attempt_id: attemptId }),
    })
    const evaluation = await evalResponse.json()
    evaluationIds.push(evaluation.evaluation.id)
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: evaluation.evaluation.id },
    })
  })

  afterAll(async () => {
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', 'in', evaluationIds)
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('id', 'in', evaluationIds)
      .execute()
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', 'in', attemptIds)
      .execute()
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', 'in', paperIds)
      .execute()
    await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'reversal-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('the reversal-word question is classified as Reading Discipline, the plain one as Conceptual Gap', async () => {
    const response = await handlerFor(
      EvaluationReportRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { id: evaluationIds[0] },
    })
    expect(response.status).toBe(200)
    const report = await response.json()

    const reversalRow = report.error_inventory.find(
      (row: { feedback: string }) =>
        row.feedback.includes('reading-discipline drill'),
    )
    const plainRow = report.error_inventory.find(
      (row: { error_type: string }) => row.error_type === 'Conceptual Gap',
    )

    expect(reversalRow).toBeDefined()
    expect(reversalRow.error_type).toBe('Reading Discipline')
    expect(plainRow).toBeDefined()
    expect(report.error_inventory).toHaveLength(2)
  })
})
