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
import { Route as RemediationListRoute } from './api/remediation'
import { Route as RemediationDetailRoute } from './api/remediation/$id'
import { Route as RemediationAttemptRoute } from './api/remediation/$id/attempt'

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
 * F066-F068: escalates a real concept to Priority via two wrong real exam rounds (the same
 * Weak->Priority sequence F103's own unit tests verify), then proves the remediation loop with
 * real drill submissions -- one high-scoring drill sustains Priority (sticky, matching F063's
 * "only clears via two consecutive >=85% attempts"), a second clears it to Maintenance.
 */
describe('remediation engine (F066-F068)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let conceptId: string
  let chapterId: string
  let blueprintId: string
  const evaluationIds: Array<string> = []
  const attemptIds: Array<string> = []
  const paperIds: Array<string> = []
  const questionIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('remediation')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Remediation Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'remediation-student',
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
    chapterId = chapter.id

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.REMEDIATION-${Date.now()}`,
      name: 'Remediation fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    for (const suffix of ['a', 'b', 'c']) {
      const q = await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `Remediation fixture question ${suffix}`,
        answer: '4',
        created_by: 'remediation-fixture',
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
      name: 'Remediation fixture blueprint',
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
          chapter_ids: [chapterId],
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
  })

  afterAll(async () => {
    await db
      .deleteFrom('remediation_tasks')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('concept_remediation_content')
      .where('concept_id', '=', conceptId)
      .execute()

    const allPapers = await db
      .selectFrom('papers')
      .select('id')
      .where('student_id', '=', studentId)
      .execute()
    const allPaperIds = allPapers.map((p) => p.id)
    const allAttempts = await db
      .selectFrom('attempts')
      .select('id')
      .where('student_id', '=', studentId)
      .execute()
    const allAttemptIds = allAttempts.map((a) => a.id)
    const allEvals = await db
      .selectFrom('evaluations')
      .select('id')
      .where(
        'attempt_id',
        'in',
        allAttemptIds.length > 0 ? allAttemptIds : [''],
      )
      .execute()
    const allEvalIds = allEvals.map((e) => e.id)

    await db
      .deleteFrom('concept_mastery')
      .where('concept_id', '=', conceptId)
      .execute()
    await db
      .deleteFrom('concept_status')
      .where('concept_id', '=', conceptId)
      .execute()
    if (allEvalIds.length > 0) {
      await db
        .deleteFrom('evaluation_items')
        .where('evaluation_id', 'in', allEvalIds)
        .execute()
      await db.deleteFrom('evaluations').where('id', 'in', allEvalIds).execute()
    }
    await db
      .deleteFrom('attempt_answers')
      .where(
        'attempt_id',
        'in',
        allAttemptIds.length > 0 ? allAttemptIds : [''],
      )
      .execute()
    await db
      .deleteFrom('attempts')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', 'in', allPaperIds.length > 0 ? allPaperIds : [''])
      .execute()
    await db.deleteFrom('papers').where('student_id', '=', studentId).execute()
    await db
      .deleteFrom('blueprints')
      .where('name', '=', 'Auto remediation drill')
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    // Scoped to this run's own question ids, not a shared `created_by` literal -- the latter used
    // to also try to delete any OTHER run's leftover 'remediation-fixture' questions (e.g. from a
    // crashed prior run that never reached its own cleanup), which could still be referenced by
    // that other run's own dangling paper_questions and throw an FK violation here, aborting the
    // rest of this afterAll.
    if (questionIds.length > 0) {
      await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    }
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('rejects an unauthenticated generate request', async () => {
    const response = await handlerFor(
      RemediationGenerateRoute,
      'POST',
    )({
      request: request('', { student_id: studentId, concept_id: conceptId }),
    })
    expect(response.status).toBe(401)
  })

  it('refuses to build a pack for a concept that is not flagged Priority', async () => {
    const otherConcept = await conceptsRepository.insert(db, {
      chapter_id: chapterId,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.REMEDIATION-NOTPRIORITY-${Date.now()}`,
      name: 'Not-priority fixture concept',
      difficulty_base: 'Easy',
    })
    const response = await handlerFor(
      RemediationGenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        concept_id: otherConcept.id,
      }),
    })
    expect(response.status).toBe(422)
    await db.deleteFrom('concepts').where('id', '=', otherConcept.id).execute()
  })

  let firstTaskId: string

  it('builds a pack with no answer key leaked', async () => {
    const response = await handlerFor(
      RemediationGenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        concept_id: conceptId,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    firstTaskId = body.task_id

    expect(body.questions).toHaveLength(3)
    expect(body.shortfall).toBe(false)
    // F060: this fixture's Priority escalation happened via a plain (non-reversal-word) wrong
    // answer, so the pack should be a normal concept refresher, not the reading-discipline path.
    expect(body.drill_kind).toBe('concept_refresher')
    for (const q of body.questions) {
      expect(q).not.toHaveProperty('answer')
      for (const o of q.options) {
        expect(o).not.toHaveProperty('is_correct')
      }
    }
  })

  it('lists the task for the student', async () => {
    const response = await handlerFor(
      RemediationListRoute,
      'GET',
    )({ request: request(student.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.tasks.some((t: { id: string }) => t.id === firstTaskId)).toBe(
      true,
    )
  })

  it('a student can view the task detail with no answer key leaked', async () => {
    const response = await handlerFor(
      RemediationDetailRoute,
      'GET',
    )({ request: request(student.cookie), params: { id: firstTaskId } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.questions).toHaveLength(3)
    expect(body.questions[0]).not.toHaveProperty('answer')
  })

  it('sustains Priority after one high-scoring drill (sticky, not cleared by a single good attempt)', async () => {
    const detail = await (
      await handlerFor(
        RemediationDetailRoute,
        'GET',
      )({ request: request(student.cookie), params: { id: firstTaskId } })
    ).json()

    const response = await handlerFor(
      RemediationAttemptRoute,
      'POST',
    )({
      request: request(student.cookie, {
        answers: detail.questions.map((q: { id: string }) => ({
          question_id: q.id,
          selected_option: 'A',
        })),
      }),
      params: { id: firstTaskId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.percentage).toBe(100)
    expect(body.priority_cleared).toBe(false)

    const status = await db
      .selectFrom('concept_status')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('concept_id', '=', conceptId)
      .executeTakeFirstOrThrow()
    expect(status.status).toBe('Priority')
  })

  it('resubmitting a completed drill is rejected', async () => {
    const response = await handlerFor(
      RemediationAttemptRoute,
      'POST',
    )({
      request: request(student.cookie, { answers: [] }),
      params: { id: firstTaskId },
    })
    expect(response.status).toBe(409)
  })

  it('a second high-scoring drill clears Priority to Maintenance', async () => {
    const genResponse = await handlerFor(
      RemediationGenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        concept_id: conceptId,
      }),
    })
    const genBody = await genResponse.json()

    const response = await handlerFor(
      RemediationAttemptRoute,
      'POST',
    )({
      request: request(student.cookie, {
        answers: genBody.questions.map((q: { id: string }) => ({
          question_id: q.id,
          selected_option: 'A',
        })),
      }),
      params: { id: genBody.task_id },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.priority_cleared).toBe(true)

    const status = await db
      .selectFrom('concept_status')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('concept_id', '=', conceptId)
      .executeTakeFirstOrThrow()
    expect(status.status).toBe('Maintenance')
  })
})

/**
 * F060: "wrong answers on [reversal-word questions] classified as reading discipline, routed to a
 * drill instead of re-teaching." Separate concept/student fixture from the describe block above --
 * that one escalates to Priority via a plain wrong answer (asserted as 'concept_refresher' there),
 * this one escalates via a reversal-word question so buildRemediationPack takes the other branch.
 */
describe('remediation engine: reading-discipline drills (F060)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let chapterId: string
  let conceptId: string
  let blueprintId: string
  let reversalQuestionId: string
  const questionIds: Array<string> = []
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('remediation-rd')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Reading Discipline Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'remediation-rd-student',
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
    chapterId = chapter.id

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.REMEDIATION-RD-${Date.now()}`,
      name: 'Reading discipline fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // One reversal-word question the exam rounds will use (so the wrong answers below classify
    // as Reading Discipline), and one plain question so the drill has more than one to pick from.
    const reversalQuestion = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Which of these is NOT an even number?',
      answer: 'B',
      created_by: 'remediation-rd-fixture',
      is_reversal_word: true,
      options: [
        { label: 'A', text: '4', is_correct: false, order_index: 1 },
        { label: 'B', text: '5', is_correct: true, order_index: 2 },
      ],
    })
    reversalQuestionId = reversalQuestion.id
    questionIds.push(reversalQuestion.id)
    // A second reversal-word question, not a plain one -- paper generation excludes a recently
    // served question from the next round (F026), so escalating across two exam rounds needs two
    // eligible questions either way. Making the second one reversal-word too (rather than plain)
    // keeps "always answer A wrong" deterministic regardless of which one gets served each round.
    const reversalQuestion2 = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Which of these is least likely to be a factor of 12?',
      answer: 'B',
      created_by: 'remediation-rd-fixture',
      is_reversal_word: true,
      options: [
        { label: 'A', text: '4', is_correct: false, order_index: 1 },
        { label: 'B', text: '5', is_correct: true, order_index: 2 },
      ],
    })
    questionIds.push(reversalQuestion2.id)

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Reading discipline fixture blueprint',
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

    // Two wrong real exam rounds -> Weak, then Priority -- same escalation sequence as the main
    // describe block above, but every generated paper here only has the reversal-word question
    // available at Tier objective/Remember/Easy for this concept, so it's the one served.
    for (let i = 0; i < 2; i++) {
      const generateResponse = await handlerFor(
        GenerateRoute,
        'POST',
      )({
        request: request(parent.cookie, {
          student_id: studentId,
          blueprint_id: blueprintId,
          chapter_ids: [chapterId],
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

      const pq = generated.paperQuestions[0]
      await handlerFor(
        AttemptAnswerRoute,
        'PATCH',
      )({
        request: request(student.cookie, {
          paper_question_id: pq.id,
          selected_option: 'A',
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
  })

  afterAll(async () => {
    await db
      .deleteFrom('remediation_tasks')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('concept_remediation_content')
      .where('concept_id', '=', conceptId)
      .execute()

    const allEvals = await db
      .selectFrom('evaluations')
      .select('id')
      .where('attempt_id', 'in', attemptIds.length > 0 ? attemptIds : [''])
      .execute()
    const allEvalIds = allEvals.map((e) => e.id)
    if (allEvalIds.length > 0) {
      await db
        .deleteFrom('evaluation_items')
        .where('evaluation_id', 'in', allEvalIds)
        .execute()
      await db.deleteFrom('evaluations').where('id', 'in', allEvalIds).execute()
    }
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', 'in', attemptIds.length > 0 ? attemptIds : [''])
      .execute()
    await db
      .deleteFrom('attempts')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', 'in', paperIds.length > 0 ? paperIds : [''])
      .execute()
    await db.deleteFrom('papers').where('student_id', '=', studentId).execute()
    await db
      .deleteFrom('blueprints')
      .where('name', '=', 'Auto remediation drill')
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    if (questionIds.length > 0) {
      await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    }
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('builds a reading-discipline drill instead of a concept refresher', async () => {
    const response = await handlerFor(
      RemediationGenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        concept_id: conceptId,
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()

    expect(body.drill_kind).toBe('reading_discipline')
    // Not the AI/bank-cached refresher path -- a fixed, framing-specific message, and no worked
    // examples (there is nothing to re-teach).
    expect(body.refresher).toMatch(/not a knowledge gap/i)
    expect(body.examples).toEqual([])
    // The reversal-word question is preferred; with only 2 eligible questions total and a drill
    // of 3, both get pulled in, but the reversal-word one must be among them.
    const questionIdsInDrill = body.questions.map((q: { id: string }) => q.id)
    expect(questionIdsInDrill).toContain(reversalQuestionId)
  })
})
