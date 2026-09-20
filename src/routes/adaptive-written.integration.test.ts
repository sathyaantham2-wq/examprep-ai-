import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { blueprintsRepository, chaptersRepository, conceptsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { gradeSubjectiveAnswer } from '../lib/ai-grading'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as AttemptAnswerRoute } from './api/attempts/$id/answer'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as ReviewRoute } from './api/attempts/$id/review'
import { Route as FinalizeRoute } from './api/attempts/$id/finalize'

// The real grader needs an API key. Each test decides what it returns.
vi.mock('../lib/ai-grading', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../lib/ai-grading')),
  gradeSubjectiveAnswer: vi.fn(),
}))

type RouteHandler = (opts: { request: Request; params?: Record<string, string> }) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  return (route.options.server as { handlers: Record<string, RouteHandler> }).handlers[method]
}

function json(cookie: string, method: string, body: unknown): Request {
  return new Request('http://localhost/test', {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
}

/**
 * Written answers on an adaptive paper: the AI grader's marks are confirmed automatically when it
 * is confident, and nothing is confirmed when it is not, so no mark is ever invented.
 */
describe('adaptive paper with a written answer', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let chapterId: string
  let conceptId: string
  let blueprintId: string
  const tag = `adapt-written-${Date.now()}`
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []

  async function submitPaper() {
    const generated = await handlerFor(GenerateRoute, 'POST')({
      request: json(student.cookie, 'POST', {
        adaptive: true,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    expect(generated.status).toBe(201)
    const body = await generated.json()
    expect(body.paperQuestions).toHaveLength(2)
    paperIds.push(body.paper.id)

    const attempt = await handlerFor(AttemptsRoute, 'POST')({
      request: json(student.cookie, 'POST', { paper_id: body.paper.id, mode: 'online' }),
    })
    const attemptId = (await attempt.json()).id as string
    attemptIds.push(attemptId)

    for (const pq of body.paperQuestions as Array<{ id: string; question_id: string }>) {
      const q = await db.selectFrom('questions').select('type').where('id', '=', pq.question_id).executeTakeFirstOrThrow()
      await handlerFor(AttemptAnswerRoute, 'PATCH')({
        request: json(student.cookie, 'PATCH', {
          paper_question_id: pq.id,
          ...(q.type === 'mcq' ? { selected_option: 'A' } : { response_text: 'a worked answer' }),
        }),
        params: { id: attemptId },
      })
    }
    const submitted = await handlerFor(AttemptSubmitRoute, 'POST')({
      request: json(student.cookie, 'POST', {}),
      params: { id: attemptId },
    })
    return submitted.json()
  }

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('adapt-written')
    const created = await handlerFor(StudentsRoute, 'POST')({
      request: json(parent.cookie, 'POST', { name: 'Written Kid', class: 7, board: 'CBSE', consent_accepted: true }),
    })
    studentId = (await created.json()).id
    student = await createStudentSession('adapt-written-student', parent.householdId, studentId)

    const subject = await db.selectFrom('subjects').selectAll().where('code', '=', 'MATH-SEED').executeTakeFirstOrThrow()
    const seedChapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .where('chapter_no', '=', 1)
      .executeTakeFirstOrThrow()
    const chapterNo = 9000 + Math.floor(Math.random() * 900)
    const chapter = await chaptersRepository.insert(db, {
      subject_id: subject.id,
      source_id: seedChapter.source_id,
      part: 'I',
      chapter_no: chapterNo,
      name: 'Adaptive written fixture chapter',
      order_index: chapterNo,
    })
    chapterId = chapter.id
    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `ADAPT-W-${Date.now()}`,
      name: 'Adaptive written fixture concept',
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
      text: `${tag} mcq`,
      answer: 'A',
      created_by: tag,
      options: [
        { label: 'A', text: 'right', is_correct: true, order_index: 1 },
        { label: 'B', text: 'wrong', is_correct: false, order_index: 2 },
      ],
    })
    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Analyse',
      difficulty: 'Hard',
      marks: 2,
      type: 'short_answer',
      text: `${tag} short answer`,
      answer: 'The expected working.',
      created_by: tag,
      step_marks: [
        { step_no: 1, description: 'Sets up the working', marks: 1 },
        { step_no: 2, description: 'Reaches the answer', marks: 1 },
      ],
    })

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Adaptive written fixture blueprint',
      duration_min: 10,
      total_marks: 3,
      sections: JSON.stringify([
        { name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] },
        { name: 'Section B', marks_per_question: 2, count: 1, bloom_allowed: ['Analyse'] },
      ]),
      bloom_targets: JSON.stringify({ Remember: 0, Understand: 0, Apply: 0, Analyse: 0, Evaluate: 0, Create: 0 }),
    })
    blueprintId = blueprint.id
  })

  afterAll(async () => {
    const evaluations = attemptIds.length
      ? await db.selectFrom('evaluations').select('id').where('attempt_id', 'in', attemptIds).execute()
      : []
    const evaluationIds = evaluations.map((e) => e.id)
    if (evaluationIds.length > 0) {
      await db.deleteFrom('audit_log').where('entity_id', 'in', evaluationIds).execute()
      await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', evaluationIds).execute()
      await db.deleteFrom('evaluations').where('id', 'in', evaluationIds).execute()
    }
    await db.deleteFrom('attempt_answers').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    await db.deleteFrom('paper_questions').where('paper_id', 'in', paperIds).execute()
    await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    await db.deleteFrom('concept_status').where('concept_id', '=', conceptId).execute()
    await db.deleteFrom('concept_mastery').where('concept_id', '=', conceptId).execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('created_by', '=', tag).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.destroy()
  })

  it('leaves the paper for a parent when the AI cannot mark the written answer', async () => {
    vi.mocked(gradeSubjectiveAnswer).mockResolvedValue(null)
    const result = await submitPaper()
    expect(result.evaluation_id).toBeNull()

    const evaluation = await db
      .selectFrom('evaluations')
      .select(['confirmed_at'])
      .where('attempt_id', '=', attemptIds[0])
      .executeTakeFirstOrThrow()
    expect(evaluation.confirmed_at).toBeNull()
    const logged = await db.selectFrom('concept_answer_log').select('id').where('student_id', '=', studentId).execute()
    expect(logged).toHaveLength(0)
  })

  it('leaves AI-marked written answers for the student to review, then confirms when she accepts', async () => {
    vi.mocked(gradeSubjectiveAnswer).mockResolvedValue({
      stepMarksAwarded: [
        { step_no: 1, marks_awarded: 1, justification: 'Set up correctly' },
        { step_no: 2, marks_awarded: 0, justification: 'Did not reach the answer' },
      ],
      totalMarks: 1,
      errorType: 'Incomplete',
      feedback: 'Good start.',
      confidence: 0.9,
      needsManualMarking: false,
    })
    const result = await submitPaper()
    expect(result.evaluation_id).toBeNull()
    expect(result.review_pending).toBe(true)
    const attemptId = attemptIds[attemptIds.length - 1]

    // Nothing is final, and nothing has reached her mastery record yet.
    const pending = await db
      .selectFrom('evaluations')
      .select(['id', 'confirmed_at'])
      .where('attempt_id', '=', attemptId)
      .executeTakeFirstOrThrow()
    expect(pending.confirmed_at).toBeNull()
    const before = await db.selectFrom('concept_answer_log').select('id').where('evaluation_id', '=', pending.id).execute()
    expect(before).toHaveLength(0)

    const review = await (
      await handlerFor(ReviewRoute, 'GET')({ request: json(student.cookie, 'GET', undefined), params: { id: attemptId } })
    ).json()
    expect(review.state).toBe('review')
    expect(review.written).toHaveLength(1)
    expect(review.written[0].marks_awarded).toBe(1)

    const finalized = await handlerFor(FinalizeRoute, 'POST')({
      request: json(student.cookie, 'POST', {}),
      params: { id: attemptId },
    })
    expect(finalized.status).toBe(200)

    const evaluation = await db
      .selectFrom('evaluations')
      .select(['confirmed_at', 'actual_score', 'evaluated_by'])
      .where('id', '=', pending.id)
      .executeTakeFirstOrThrow()
    expect(evaluation.confirmed_at).not.toBeNull()
    expect(Number(evaluation.actual_score)).toBe(2)
    expect(evaluation.evaluated_by).toBe('ai')

    const audit = await db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', pending.id)
      .where('action', '=', 'evaluation.student_finalized')
      .execute()
    expect(audit).toHaveLength(1)

    const partial = await db
      .selectFrom('concept_answer_log')
      .select(['credit', 'level'])
      .where('evaluation_id', '=', pending.id)
      .orderBy('level')
      .execute()
    expect(partial.map((p) => Number(p.credit))).toEqual([1, 0.5])
    expect(partial.map((p) => p.level)).toEqual([1, 3])
  })
})
