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
import { Route as RemediationGenerateRoute } from './api/remediation/generate'
import { Route as DashboardRoute } from './api/dashboard/$studentId'

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
 * F076: "On login: last session date, last paper evaluated, current priority concepts, pending
 * items." Escalates a real concept to Priority via two wrong real exam rounds (the same
 * Weak->Priority sequence remediation.integration.test.ts uses), then builds a real remediation
 * pack so there is a genuine pending item, and checks the parent dashboard's recap surfaces all
 * four data points from real state.
 */
describe('session-opening recap (F076)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  const questionIds: Array<string> = []
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []
  const evaluationIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('recap')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Recap Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession('recap-student', parent.householdId, studentId)

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
      code: `C7M-1.RECAP-${Date.now()}`,
      name: 'Recap fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // Three questions: two consumed by the two escalation rounds below (F026 excludes a
    // recently-served question from the next paper), one left spare for buildRemediationPack.
    for (const suffix of ['a', 'b', 'c']) {
      const q = await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `Recap fixture question ${suffix}`,
        answer: '4',
        created_by: 'recap-fixture',
        options: [
          { label: 'A', text: '4', is_correct: true, order_index: 1 },
          { label: 'B', text: '5', is_correct: false, order_index: 2 },
        ],
      })
      questionIds.push(q.id)
    }

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Recap fixture blueprint',
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

    // Two wrong real exam rounds -> Weak, then Weak-again escalates to Priority.
    for (let i = 0; i < 2; i++) {
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
      )({ request: request(student.cookie, { paper_id: generated.paper.id, mode: 'online' }) })
      const attemptId = (await attemptResponse.json()).id
      attemptIds.push(attemptId)

      const pq = generated.paperQuestions[0]
      await handlerFor(
        AttemptAnswerRoute,
        'PATCH',
      )({
        request: request(student.cookie, {
          paper_question_id: pq.id,
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
      evaluationIds.push(evaluation.evaluation.id)
      await handlerFor(
        EvaluationConfirmRoute,
        'POST',
      )({
        request: request(parent.cookie, {}),
        params: { id: evaluation.evaluation.id },
      })
    }

    const status = await db
      .selectFrom('concept_status')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('concept_id', '=', conceptId)
      .executeTakeFirstOrThrow()
    expect(status.status).toBe('Priority')

    // A real pending item: the third spare question is what makes this succeed.
    await handlerFor(
      RemediationGenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, { student_id: studentId, concept_id: conceptId }),
    })
  })

  afterAll(async () => {
    await db
      .deleteFrom('remediation_tasks')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('evaluation_items')
      .where('evaluation_id', 'in', evaluationIds.length > 0 ? evaluationIds : [''])
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('id', 'in', evaluationIds.length > 0 ? evaluationIds : [''])
      .execute()
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', 'in', attemptIds.length > 0 ? attemptIds : [''])
      .execute()
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    if (paperIds.length > 0) {
      await db.deleteFrom('paper_questions').where('paper_id', 'in', paperIds).execute()
      await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    }
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it("surfaces the last session, last evaluated paper, priority concept, and a pending item", async () => {
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({ request: request(parent.cookie), params: { studentId } })
    expect(response.status).toBe(200)
    const dashboard = await response.json()

    const today = new Date().toISOString().slice(0, 10)
    expect(dashboard.recap.last_session_date).toBe(today)

    expect(dashboard.recap.last_paper_evaluated).not.toBeNull()
    expect(dashboard.recap.last_paper_evaluated.paper_title).toBe(
      'Recap fixture blueprint',
    )
    expect(dashboard.recap.last_paper_evaluated.percentage).toBe(0)

    const priorityConcept = dashboard.recap.current_priority_concepts.find(
      (c: { concept_id: string }) => c.concept_id === conceptId,
    )
    expect(priorityConcept).toBeDefined()
    expect(priorityConcept.subject_name).toBeTruthy()

    expect(
      dashboard.recap.pending_items.some(
        (item: { kind: string }) => item.kind === 'remediation',
      ),
    ).toBe(true)
  })

  it("another household's dashboard never sees this student's recap", async () => {
    const otherParent = await createParentSession('recap-other')
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({ request: request(otherParent.cookie), params: { studentId } })
    expect(response.status).toBe(404)
    await db.deleteFrom('households').where('id', '=', otherParent.householdId).execute()
  })
})
