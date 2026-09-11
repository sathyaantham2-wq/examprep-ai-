import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  blueprintsRepository,
  conceptStatusRepository,
} from '../db/repositories'
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
 * F018: "Concept can list prerequisite concept IDs; weak concept surfaces its unmastered
 * prerequisites in the diagnosis." The target concept has two prerequisites: one never attempted
 * (no concept_status row at all) and one already Strong. Runs a real generate -> attempt (wrong
 * answer) -> submit -> evaluate -> confirm cycle on the target so it lands at Weak, then checks
 * the diagnosis report surfaces only the unmastered one.
 */
describe('concept prerequisite graph (F018)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptWeakId: string
  let conceptPrereqUnmasteredId: string
  let conceptPrereqMasteredId: string
  let evaluationId: string
  const questionIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('prereq')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Prereq Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession('prereq-student', parent.householdId, studentId)

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

    const prereqUnmastered = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.PREREQ-UNMASTERED-${Date.now()}`,
      name: 'Prerequisite fixture concept (never attempted)',
      difficulty_base: 'Easy',
    })
    conceptPrereqUnmasteredId = prereqUnmastered.id

    const prereqMastered = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.PREREQ-MASTERED-${Date.now()}`,
      name: 'Prerequisite fixture concept (already mastered)',
      difficulty_base: 'Easy',
    })
    conceptPrereqMasteredId = prereqMastered.id
    await conceptStatusRepository.upsert(db, {
      student_id: studentId,
      concept_id: conceptPrereqMasteredId,
      status: 'Strong',
    })

    const conceptWeak = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.PREREQ-TARGET-${Date.now()}`,
      name: 'Prerequisite fixture concept (target, will be Weak)',
      difficulty_base: 'Easy',
      prerequisite_concept_ids: [conceptPrereqUnmasteredId, conceptPrereqMasteredId],
    })
    conceptWeakId = conceptWeak.id

    const question = await createQuestion(db, {
      concept_id: conceptWeakId,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Prerequisite fixture question',
      answer: '1',
      created_by: 'prereq-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    questionIds.push(question.id)

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Prerequisite fixture blueprint',
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
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      }),
    })
    const generated = await generateResponse.json()
    const paperQuestionId = generated.paperQuestions[0].id

    const attemptResponse = await handlerFor(
      AttemptsRoute,
      'POST',
    )({ request: request(student.cookie, { paper_id: generated.paper.id, mode: 'online' }) })
    const attemptId = (await attemptResponse.json()).id

    // Wrong answer on purpose -- ratio 0 lands the target concept at Weak on first attempt
    // (F062's threshold: raw ratio < 0.5 -> Weak).
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: paperQuestionId,
        selected_option: 'B',
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
    const evaluation = await evalResponse.json()
    evaluationId = evaluation.evaluation.id
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({ request: request(parent.cookie, {}), params: { id: evaluationId } })
  })

  afterAll(async () => {
    await db.deleteFrom('evaluation_items').where('evaluation_id', '=', evaluationId).execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db
      .deleteFrom('attempt_answers')
      .where(
        'attempt_id',
        'in',
        db.selectFrom('attempts').select('id').where('student_id', '=', studentId),
      )
      .execute()
    await db.deleteFrom('attempts').where('student_id', '=', studentId).execute()
    await db
      .deleteFrom('paper_questions')
      .where(
        'paper_id',
        'in',
        db.selectFrom('papers').select('id').where('student_id', '=', studentId),
      )
      .execute()
    await db.deleteFrom('papers').where('student_id', '=', studentId).execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    await db
      .deleteFrom('concepts')
      .where('id', 'in', [conceptWeakId, conceptPrereqUnmasteredId, conceptPrereqMasteredId])
      .execute()
    await db.destroy()
  })

  it('surfaces only the unmastered prerequisite for the weak target concept', async () => {
    const response = await handlerFor(
      EvaluationReportRoute,
      'GET',
    )({ request: request(parent.cookie), params: { id: evaluationId } })
    expect(response.status).toBe(200)
    const report = await response.json()

    const targetAction = report.actions.ranked.find(
      (a: { concept_id: string }) => a.concept_id === conceptWeakId,
    )
    expect(targetAction).toBeDefined()
    expect(targetAction.status).toBe('Weak')
    expect(targetAction.unmastered_prerequisites).toHaveLength(1)
    expect(targetAction.unmastered_prerequisites[0]).toEqual({
      concept_id: conceptPrereqUnmasteredId,
      concept_name: 'Prerequisite fixture concept (never attempted)',
      status: null,
    })
    // The already-mastered prerequisite must not appear.
    const ids = targetAction.unmastered_prerequisites.map(
      (p: { concept_id: string }) => p.concept_id,
    )
    expect(ids).not.toContain(conceptPrereqMasteredId)
    // The prose action text mentions it too, not just the structured data.
    expect(targetAction.action).toContain('Prerequisite fixture concept (never attempted)')
  })
})
