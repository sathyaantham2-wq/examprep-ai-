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
import { Route as DashboardRoute } from './api/dashboard/$studentId'
import { Route as EvaluationByIdRoute } from './api/evaluations/$id'
import { Route as EvaluationItemRoute } from './api/evaluations/$id/items/$itemId'

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
 * F071: "per subject: latest score, trend, Delivery Gap, top 3 priority concepts, next action,
 * pending uploads." Runs a real paper through generate -> attempt -> submit -> evaluate ->
 * confirm twice (a weak first attempt, then a stronger second one) so trend has something real
 * to compare, then checks the dashboard reflects it -- against the real dev DB.
 */
describe('parent dashboard (F071)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let paperId1: string
  let paperId2: string
  let blueprintId: string
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('dash')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Dashboard Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'dash-student',
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
      code: `C7M-1.DASH-${Date.now()}`,
      name: 'Dashboard fixture concept',
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
      text: 'Dashboard fixture question A',
      answer: '1',
      created_by: 'dash-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
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
      text: 'Dashboard fixture question B',
      answer: '1',
      created_by: 'dash-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Dashboard fixture blueprint',
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

    // Paper 1: answered wrong (selected_option B, correct is A) -> a low first score.
    const generate1 = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      }),
    })
    const generated1 = await generate1.json()
    paperId1 = generated1.paper.id
    const paperQuestionId1 = generated1.paperQuestions[0].id

    const attempt1 = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, { paper_id: paperId1, mode: 'online' }),
    })
    const attemptId1 = (await attempt1.json()).id
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: paperQuestionId1,
        selected_option: 'B',
      }),
      params: { id: attemptId1 },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: attemptId1 },
    })
    const eval1 = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parent.cookie, { attempt_id: attemptId1 }),
    })
    const evaluation1 = await eval1.json()
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: evaluation1.evaluation.id },
    })

    // Paper 2: answered correctly -> an improved second score, so trend has something to show.
    const generate2 = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapter.id],
      }),
    })
    const generated2 = await generate2.json()
    paperId2 = generated2.paper.id
    const paperQuestionId2 = generated2.paperQuestions[0].id

    const attempt2 = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, { paper_id: paperId2, mode: 'online' }),
    })
    const attemptId2 = (await attempt2.json()).id
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: paperQuestionId2,
        selected_option: 'A',
      }),
      params: { id: attemptId2 },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: attemptId2 },
    })
    const eval2 = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({
      request: request(parent.cookie, { attempt_id: attemptId2 }),
    })
    const evaluation2 = await eval2.json()
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: evaluation2.evaluation.id },
    })
  })

  afterAll(async () => {
    await db
      .deleteFrom('evaluation_items')
      .where(
        'evaluation_id',
        'in',
        db
          .selectFrom('evaluations')
          .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
          .select('evaluations.id')
          .where('attempts.student_id', '=', studentId),
      )
      .execute()
    await db
      .deleteFrom('evaluations')
      .where(
        'attempt_id',
        'in',
        db
          .selectFrom('attempts')
          .select('id')
          .where('student_id', '=', studentId),
      )
      .execute()
    await db
      .deleteFrom('attempt_answers')
      .where(
        'attempt_id',
        'in',
        db
          .selectFrom('attempts')
          .select('id')
          .where('student_id', '=', studentId),
      )
      .execute()
    await db
      .deleteFrom('attempts')
      .where('student_id', '=', studentId)
      .execute()
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', 'in', [paperId1, paperId2])
      .execute()
    await db
      .deleteFrom('papers')
      .where('id', 'in', [paperId1, paperId2])
      .execute()
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db
      .deleteFrom('questions')
      .where('created_by', '=', 'dash-fixture')
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('shows the subject card with an improving trend after a second, better attempt', async () => {
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { studentId },
    })
    expect(response.status).toBe(200)
    const dashboard = await response.json()
    expect(dashboard.subjects).toHaveLength(1)

    const card = dashboard.subjects[0]
    expect(card.subject_name).toBe('Mathematics (seed)')
    expect(card.latest_score.percentage).toBe(100)
    expect(card.trend).toBe('up')

    // F075: score-over-time is oldest-first and reflects both real confirmed evaluations.
    expect(card.score_history).toHaveLength(2)
    expect(card.score_history[0].percentage).toBe(0)
    expect(card.score_history[1].percentage).toBe(100)

    expect(dashboard.concept_status_distribution.Strong).toBeGreaterThanOrEqual(
      1,
    )
  })

  it('another household gets 404', async () => {
    const otherParent = await createParentSession('dash-other')
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({
      request: request(otherParent.cookie),
      params: { studentId },
    })
    expect(response.status).toBe(404)
    await db
      .deleteFrom('households')
      .where('id', '=', otherParent.householdId)
      .execute()
  })
})

/**
 * F065: "patterns ... aggregated across all subjects, not just per paper." The query itself
 * (patternHitsRepository.countForStudent) never filters or partitions by subject_id, so proving
 * it sums across two SEPARATE confirmed evaluations is the structurally correct test of "not just
 * per paper" -- a real second subject isn't needed to exercise that code path.
 */
describe('cross-subject pattern roll-up on the dashboard (F065)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let patternId: string
  const questionIds: Array<string> = []
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('dash-pattern')

    const pattern = await db
      .selectFrom('patterns')
      .select('id')
      .where('code', '=', 'P1')
      .executeTakeFirstOrThrow()
    patternId = pattern.id

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Dashboard Pattern Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'dash-pattern-student',
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
      code: `C7M-1.DASHPATTERN-${Date.now()}`,
      name: 'Dashboard pattern fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // Two questions, not one -- paper generation excludes a recently served question from the
    // next round (F026), and this fixture generates two separate papers back to back.
    for (const suffix of ['A', 'B']) {
      const question = await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `Dashboard pattern fixture question ${suffix}`,
        answer: '1',
        created_by: 'dash-pattern-fixture',
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
      name: 'Dashboard pattern fixture blueprint',
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

    // Two separate confirmed evaluations, each with the same pattern tagged on its one item --
    // GET /api/dashboard/:studentId should report this pattern with count 2, not 1 per paper.
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

      const detailResponse = await handlerFor(
        EvaluationByIdRoute,
        'GET',
      )({
        request: request(parent.cookie),
        params: { id: evaluation.evaluation.id },
      })
      const detail = await detailResponse.json()
      const itemId = detail.items[0].id

      await handlerFor(
        EvaluationItemRoute,
        'PATCH',
      )({
        request: request(parent.cookie, { pattern_ids: [patternId] }),
        params: { id: evaluation.evaluation.id, itemId },
      })

      await handlerFor(
        EvaluationConfirmRoute,
        'POST',
      )({
        request: request(parent.cookie, {}),
        params: { id: evaluation.evaluation.id },
      })
    }
  })

  afterAll(async () => {
    const allEvals = await db
      .selectFrom('evaluations')
      .select('id')
      .where('attempt_id', 'in', attemptIds.length > 0 ? attemptIds : [''])
      .execute()
    const allEvalIds = allEvals.map((e) => e.id)
    if (allEvalIds.length > 0) {
      const allItems = await db
        .selectFrom('evaluation_items')
        .select('id')
        .where('evaluation_id', 'in', allEvalIds)
        .execute()
      const allItemIds = allItems.map((i) => i.id)
      if (allItemIds.length > 0) {
        await db
          .deleteFrom('pattern_hits')
          .where('evaluation_item_id', 'in', allItemIds)
          .execute()
      }
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
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    if (paperIds.length > 0) {
      await db
        .deleteFrom('paper_questions')
        .where('paper_id', 'in', paperIds)
        .execute()
      await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    }
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    // Scoped to this run's own question ids -- see remediation.integration.test.ts's afterAll
    // for why a shared created_by literal is unsafe here.
    if (questionIds.length > 0) {
      await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    }
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('sums the same pattern across two separate confirmed papers, not per-paper', async () => {
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { studentId },
    })
    expect(response.status).toBe(200)
    const dashboard = await response.json()

    const p1 = dashboard.pattern_frequency.find(
      (p: { pattern_id: string }) => p.pattern_id === patternId,
    )
    expect(p1).toBeDefined()
    expect(p1.count).toBe(2)
  })
})

/**
 * F123 follow-on: a submitted-but-unevaluated attempt had no UI anywhere pointing a parent/admin
 * at /evaluate/:attemptId -- discovered live right after the papers-to-attempt list shipped.
 * needs_evaluation must include a submitted attempt with no evaluation row at all, and must
 * exclude one whose evaluation has already been confirmed.
 */
describe('needs_evaluation on the parent dashboard (F123 follow-on)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let blueprintId: string
  let conceptId: string
  let chapterId: string
  const questionIds: Array<string> = []
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []
  let unevaluatedAttemptId: string
  let confirmedPaperTitle: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('dash-needs-eval')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Needs Eval Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'dash-needs-eval-student',
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
      code: `C7M-1.DASHNEEDSEVAL-${Date.now()}`,
      name: 'Needs eval fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    for (const suffix of ['A', 'B']) {
      const question = await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `Needs eval fixture question ${suffix}`,
        answer: '1',
        created_by: 'dash-needs-eval-fixture',
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
      name: 'Needs eval fixture blueprint',
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

    // Paper 1: submitted, left unevaluated -- this is the one needs_evaluation must surface.
    const generate1 = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    const generated1 = await generate1.json()
    paperIds.push(generated1.paper.id)
    confirmedPaperTitle = generated1.paper.title
    const attempt1 = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, {
        paper_id: generated1.paper.id,
        mode: 'online',
      }),
    })
    unevaluatedAttemptId = (await attempt1.json()).id
    attemptIds.push(unevaluatedAttemptId)
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: generated1.paperQuestions[0].id,
        selected_option: 'A',
      }),
      params: { id: unevaluatedAttemptId },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: unevaluatedAttemptId },
    })

    // Paper 2: submitted AND confirmed -- must NOT appear in needs_evaluation.
    const generate2 = await handlerFor(
      GenerateRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        student_id: studentId,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
      }),
    })
    const generated2 = await generate2.json()
    paperIds.push(generated2.paper.id)
    const attempt2 = await handlerFor(
      AttemptsRoute,
      'POST',
    )({
      request: request(student.cookie, {
        paper_id: generated2.paper.id,
        mode: 'online',
      }),
    })
    const attemptId2 = (await attempt2.json()).id
    attemptIds.push(attemptId2)
    await handlerFor(
      AttemptAnswerRoute,
      'PATCH',
    )({
      request: request(student.cookie, {
        paper_question_id: generated2.paperQuestions[0].id,
        selected_option: 'A',
      }),
      params: { id: attemptId2 },
    })
    await handlerFor(
      AttemptSubmitRoute,
      'POST',
    )({
      request: request(student.cookie, {}),
      params: { id: attemptId2 },
    })
    const eval2 = await handlerFor(
      EvaluationsRoute,
      'POST',
    )({ request: request(parent.cookie, { attempt_id: attemptId2 }) })
    const evaluation2 = await eval2.json()
    await handlerFor(
      EvaluationConfirmRoute,
      'POST',
    )({
      request: request(parent.cookie, {}),
      params: { id: evaluation2.evaluation.id },
    })
  })

  afterAll(async () => {
    if (attemptIds.length > 0) {
      await db
        .deleteFrom('attempt_answers')
        .where('attempt_id', 'in', attemptIds)
        .execute()
    }
    await db
      .deleteFrom('evaluation_items')
      .where(
        'evaluation_id',
        'in',
        db.selectFrom('evaluations').select('id').where('attempt_id', 'in', attemptIds),
      )
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('attempt_id', 'in', attemptIds)
      .execute()
    if (attemptIds.length > 0) {
      await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    }
    if (paperIds.length > 0) {
      await db
        .deleteFrom('paper_questions')
        .where('paper_id', 'in', paperIds)
        .execute()
      await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    }
    await db
      .deleteFrom('households')
      .where('id', '=', parent.householdId)
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    if (questionIds.length > 0) {
      await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
    }
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  })

  it('lists the submitted-unevaluated attempt and excludes the confirmed one', async () => {
    const response = await handlerFor(
      DashboardRoute,
      'GET',
    )({
      request: request(parent.cookie),
      params: { studentId },
    })
    expect(response.status).toBe(200)
    const dashboard = await response.json()

    const needsEval: Array<{ attempt_id: string; paper_title: string }> =
      dashboard.needs_evaluation
    expect(needsEval).toHaveLength(1)
    expect(needsEval[0].attempt_id).toBe(unevaluatedAttemptId)
    expect(needsEval[0].paper_title).toBe(confirmedPaperTitle)
  })
})
