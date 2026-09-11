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
 * F030: "Choice pairs marked in the paper, counted once in total marks, and handled correctly in
 * evaluation and coverage stats." A blueprint with one section of 2 slots and choice_rules
 * [{section, count: 1}] makes the first slot an OR pair -- drives the real
 * generate -> attempt (answering only ONE pair member) -> submit -> evaluate -> coverage pipeline
 * and checks every stage counts the pair once, not twice.
 */
describe('internal choice / OR pairs (F030)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  const questionIds: Array<string> = []
  let paperId: string
  let attemptId: string
  const evaluationIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('choice')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Choice Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession('choice-student', parent.householdId, studentId)

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
      code: `C7M-1.CHOICE-${Date.now()}`,
      name: 'Internal choice fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // Three questions: two become the OR pair's primary+alternate, one fills the section's other
    // (non-choice) slot.
    for (const suffix of ['A', 'B', 'C']) {
      const question = await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 2,
        type: 'mcq',
        text: `Internal choice fixture question ${suffix}`,
        answer: '1',
        created_by: 'choice-fixture',
        options: [
          { label: 'A', text: '1', is_correct: true, order_index: 1 },
          { label: 'B', text: '2', is_correct: false, order_index: 2 },
        ],
      })
      questionIds.push(question.id)
    }

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Internal choice fixture blueprint',
      duration_min: 20,
      total_marks: 4,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 2,
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
      choice_rules: JSON.stringify([{ section: 'Section A', count: 1 }]),
    })
    blueprintId = blueprint.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', 'in', evaluationIds.length > 0 ? evaluationIds : [''])
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('id', 'in', evaluationIds.length > 0 ? evaluationIds : [''])
      .execute()
    if (attemptId) {
      await db.deleteFrom('attempt_answers').where('attempt_id', '=', attemptId).execute()
      await db.deleteFrom('attempts').where('id', '=', attemptId).execute()
    }
    if (paperId) {
      await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
      await db.deleteFrom('papers').where('id', '=', paperId).execute()
    }
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    if (questionIds.length > 0) {
      await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    }
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('generates 3 paper_questions rows (an OR pair + one normal slot) with total_marks counted once', async () => {
    const response = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [
          (await db.selectFrom('concepts').select('chapter_id').where('id', '=', conceptId).executeTakeFirstOrThrow()).chapter_id,
        ],
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    paperId = body.paper.id
    expect(body.shortfalls).toEqual([])
    // Not 6 -- the pair's 2 marks count once, plus the normal slot's 2 marks.
    expect(body.paper.total_marks).toBe(4)
    expect(body.paperQuestions).toHaveLength(3)

    const groups = new Set(
      body.paperQuestions.map((pq: { choice_group: string | null }) => pq.choice_group),
    )
    // One real choice_group (shared by exactly 2 rows) plus null for the ungrouped slot.
    expect(groups.size).toBe(2)
    const grouped = body.paperQuestions.filter(
      (pq: { choice_group: string | null }) => pq.choice_group !== null,
    )
    expect(grouped).toHaveLength(2)
    expect(grouped[0].choice_group).toBe(grouped[1].choice_group)
  })

  it('answering only one member of the pair, evaluation counts marks and items once', async () => {
    const paperQuestions = await db
      .selectFrom('paper_questions')
      .selectAll()
      .where('paper_id', '=', paperId)
      .orderBy('position')
      .execute()
    const [pairPrimary, , normalSlot] = paperQuestions
    expect(pairPrimary.choice_group).not.toBeNull()
    expect(normalSlot.choice_group).toBeNull()

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({ request: request(student.cookie, { paper_id: paperId, mode: 'online' }) })
    attemptId = (await attemptResponse.json()).id

    // Answer the PRIMARY member of the pair and the normal slot -- deliberately leave the
    // alternate member blank, the way a real student choosing "the first OR option" would.
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: pairPrimary.id,
        selected_option: 'A',
      }),
      params: { id: attemptId },
    })
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: normalSlot.id,
        selected_option: 'A',
      }),
      params: { id: attemptId },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({ request: request(student.cookie, { confirm_blanks: true }), params: { id: attemptId } })

    const evalResponse = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({ request: request(parent.cookie, { attempt_id: attemptId }) })
    const evaluation = await evalResponse.json()
    evaluationIds.push(evaluation.evaluation.id)

    // Not 6 -- one pair member (2) + the normal slot (2). total_marks is a numeric column, so
    // the JSON response carries it as a string (pg's default for numeric to avoid precision
    // loss) -- Number() it before comparing.
    expect(Number(evaluation.evaluation.total_marks)).toBe(4)
    // Exactly 2 items, not 3 -- the unanswered alternate never becomes its own evaluation_item.
    expect(evaluation.items).toHaveLength(2)
    const scoredForPair = evaluation.items.find(
      (item: { paper_question_id: string }) => item.paper_question_id === pairPrimary.id,
    )
    expect(scoredForPair).toBeDefined()
    expect(Number(scoredForPair.marks_awarded)).toBe(2) // answered correctly (option A)
  })

  it('the coverage table counts the pair once, not twice', async () => {
    const response = await handlerFor(
      CoverageRoute,
      'GET',
    )({ request: request(parent.cookie), params: { id: paperId } })
    expect(response.status).toBe(200)
    const coverage = await response.json()
    expect(coverage).toHaveLength(1)
    expect(coverage[0].concept_id).toBe(conceptId)
    expect(coverage[0].question_count).toBe(2) // the pair (deduped to 1) + the normal slot
    expect(coverage[0].marks).toBe(4)
  })
})
