import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { blueprintsRepository, chaptersRepository, conceptsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { gradeSubjectiveAnswer, reviewDisputedAnswer } from '../lib/ai-grading'
import { Route as StudentsRoute } from './api/students'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as AttemptAnswerRoute } from './api/attempts/$id/answer'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as ReviewRoute } from './api/attempts/$id/review'
import { Route as FinalizeRoute } from './api/attempts/$id/finalize'
import { Route as DisputeRoute } from './api/attempts/$id/items/$itemId/dispute'
import { Route as RemoveRoute } from './api/attempts/$id/items/$itemId/remove'

vi.mock('../lib/ai-grading', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../lib/ai-grading')),
  gradeSubjectiveAnswer: vi.fn(),
  reviewDisputedAnswer: vi.fn(),
}))

type RouteHandler = (opts: { request: Request; params?: Record<string, string> }) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  return (route.options.server as { handlers: Record<string, RouteHandler> }).handlers[method]
}

function call(cookie: string, method: string, body?: unknown): Request {
  return new Request('http://localhost/test', {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
}

const SECRET = 'SECRET-EXPECTED-ANSWER'

/**
 * A student questions AI marks on written answers: one AI re-review per answer, at most five
 * answers per paper, removing a question only after that, and a grade worked out from what is
 * left. The AI vendor is replaced by mocks; everything else is the real code and database.
 */
describe('written answer review: question a mark, remove a question, accept', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let otherStudent: TestSession
  let chapterId: string
  let conceptId: string
  let blueprintId: string
  let attemptId = ''
  let evaluationId = ''
  const tag = `adapt-review-${Date.now()}`
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []
  let itemIds: Array<string> = []

  async function makeStudent(name: string, prefix: string) {
    const created = await handlerFor(StudentsRoute, 'POST')({
      request: call(parent.cookie, 'POST', { name, class: 7, board: 'CBSE', consent_accepted: true }),
    })
    const id = (await created.json()).id as string
    return createStudentSession(prefix, parent.householdId, id)
  }

  const review = async (cookie = student.cookie) =>
    (await handlerFor(ReviewRoute, 'GET')({ request: call(cookie, 'GET'), params: { id: attemptId } })).json()

  const dispute = (index: number, comment = 'I did show the working for this one') =>
    handlerFor(DisputeRoute, 'POST')({
      request: call(student.cookie, 'POST', { comment }),
      params: { id: attemptId, itemId: itemIds[index] },
    })

  const remove = (index: number) =>
    handlerFor(RemoveRoute, 'POST')({
      request: call(student.cookie, 'POST'),
      params: { id: attemptId, itemId: itemIds[index] },
    })

  const raised = {
    stepMarksAwarded: [{ step_no: 1, marks_awarded: 1, justification: 'ok' }, { step_no: 2, marks_awarded: 1, justification: 'ok' }],
    totalMarks: 2,
    reply: 'You are right, the working was there. I have raised your mark.',
    changed: true,
  }

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('adapt-review')
    student = await makeStudent('Review Kid', 'adapt-review-student')
    otherStudent = await makeStudent('Other Review Kid', 'adapt-review-other')

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
      name: 'Adaptive review fixture chapter',
      order_index: chapterNo,
    })
    chapterId = chapter.id
    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `ADAPT-R-${Date.now()}`,
      name: 'Adaptive review fixture concept',
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
    for (let i = 0; i < 6; i++) {
      await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Analyse',
        difficulty: 'Hard',
        marks: 2,
        type: 'short_answer',
        text: `${tag} short answer ${i}`,
        answer: SECRET,
        created_by: tag,
        step_marks: [
          { step_no: 1, description: 'Sets up the working', marks: 1 },
          { step_no: 2, description: 'Reaches the answer', marks: 1 },
        ],
      })
    }
    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Adaptive review fixture blueprint',
      duration_min: 20,
      total_marks: 13,
      sections: JSON.stringify([
        { name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] },
        { name: 'Section B', marks_per_question: 2, count: 6, bloom_allowed: ['Analyse'] },
      ]),
      bloom_targets: JSON.stringify({ Remember: 0, Understand: 0, Apply: 0, Analyse: 0, Evaluate: 0, Create: 0 }),
    })
    blueprintId = blueprint.id

    vi.mocked(gradeSubjectiveAnswer).mockResolvedValue({
      stepMarksAwarded: [{ step_no: 1, marks_awarded: 1, justification: 'set up' }, { step_no: 2, marks_awarded: 0, justification: 'no answer' }],
      totalMarks: 1,
      errorType: 'Incomplete',
      feedback: 'Show the last step.',
      confidence: 0.9,
      needsManualMarking: false,
    })

    const generated = await handlerFor(GenerateRoute, 'POST')({
      request: call(student.cookie, 'POST', {
        adaptive: true,
        blueprint_id: blueprintId,
        chapter_ids: [chapterId],
        recent_usage_window_days: 0,
      }),
    })
    const paper = await generated.json()
    expect(paper.paperQuestions).toHaveLength(7)
    paperIds.push(paper.paper.id)
    const attempt = await handlerFor(AttemptsRoute, 'POST')({
      request: call(student.cookie, 'POST', { paper_id: paper.paper.id, mode: 'online' }),
    })
    attemptId = (await attempt.json()).id
    attemptIds.push(attemptId)
    for (const pq of paper.paperQuestions as Array<{ id: string; question_id: string }>) {
      const q = await db.selectFrom('questions').select('type').where('id', '=', pq.question_id).executeTakeFirstOrThrow()
      await handlerFor(AttemptAnswerRoute, 'PATCH')({
        request: call(student.cookie, 'PATCH', {
          paper_question_id: pq.id,
          ...(q.type === 'mcq' ? { selected_option: 'A' } : { response_text: 'my worked answer' }),
        }),
        params: { id: attemptId },
      })
    }
    const submitted = await (
      await handlerFor(AttemptSubmitRoute, 'POST')({ request: call(student.cookie, 'POST'), params: { id: attemptId } })
    ).json()
    expect(submitted.review_pending).toBe(true)
    const first = await review()
    evaluationId = first.evaluation_id
    itemIds = first.written.map((w: { item_id: string }) => w.item_id)
  })

  afterAll(async () => {
    await db.deleteFrom('audit_log').where('entity_id', '=', evaluationId).execute()
    await db.deleteFrom('evaluation_items').where('evaluation_id', '=', evaluationId).execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
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

  it('shows the multiple-choice total and each written mark, with no answer key', async () => {
    const data = await review()
    expect(data.state).toBe('review')
    expect(data.written).toHaveLength(6)
    expect(data.disputes_used).toBe(0)
    expect(data.disputes_max).toBe(5)
    expect(data.objective).toEqual({ marks: 1, marks_max: 1, count: 1 })
    expect(data.written.every((w: { marks_awarded: number; marks_max: number }) => w.marks_awarded === 1 && w.marks_max === 2)).toBe(true)
    expect(data.total_now).toBe(7)
    expect(data.total_max).toBe(13)
    expect(JSON.stringify(data)).not.toContain(SECRET)
  })

  it('keeps another student out', async () => {
    const response = await handlerFor(ReviewRoute, 'GET')({ request: call(otherStudent.cookie, 'GET'), params: { id: attemptId } })
    expect(response.status).toBe(404)
    const disputeResponse = await handlerFor(DisputeRoute, 'POST')({
      request: call(otherStudent.cookie, 'POST', { comment: 'this is not my paper' }),
      params: { id: attemptId, itemId: itemIds[0] },
    })
    expect(disputeResponse.status).toBe(404)
  })

  it('does not let a question be removed before the AI has looked again', async () => {
    const response = await remove(0)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('not_disputed')
  })

  it('needs a real reason', async () => {
    const response = await dispute(0, 'no')
    expect(response.status).toBe(400)
  })

  it('raises a mark when the AI agrees, and records the exchange', async () => {
    vi.mocked(reviewDisputedAnswer).mockResolvedValueOnce(raised)
    const response = await dispute(0)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, changed: true, marks_before: 1, marks_after: 2, disputes_used: 1 })
    expect(body.reply).toMatch(/raised/)

    const data = await review()
    expect(data.written[0].marks_awarded).toBe(2)
    expect(data.written[0].dispute.comment).toBe('I did show the working for this one')
    expect(data.total_now).toBe(8)
  })

  it('gives each answer one re-review only', async () => {
    const response = await dispute(0)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('already_disputed')
  })

  it('does not use up a re-review when the AI fails', async () => {
    vi.mocked(reviewDisputedAnswer).mockRejectedValueOnce(new Error('Gemini API 429'))
    const failed = await dispute(1)
    expect(failed.status).toBe(502)
    expect((await review()).disputes_used).toBe(1)

    vi.mocked(reviewDisputedAnswer).mockResolvedValueOnce(raised)
    expect((await dispute(1)).status).toBe(200)
  })

  it('lets a student question up to five answers on one paper, not a sixth', async () => {
    // Answer 3 stays at its mark; answers 4 and 5 are raised.
    vi.mocked(reviewDisputedAnswer).mockResolvedValueOnce({
      stepMarksAwarded: [],
      totalMarks: 1,
      reply: 'I looked again and the mark stays. The last step was not shown.',
      changed: false,
    })
    const keep = await (await dispute(2)).json()
    expect(keep).toMatchObject({ ok: true, changed: false, marks_before: 1, marks_after: 1 })
    vi.mocked(reviewDisputedAnswer).mockResolvedValueOnce(raised).mockResolvedValueOnce(raised)
    expect((await dispute(3)).status).toBe(200)
    expect((await dispute(4)).status).toBe(200)

    expect((await review()).disputes_used).toBe(5)
    const sixth = await dispute(5)
    expect(sixth.status).toBe(409)
    expect((await sixth.json()).error).toBe('limit_reached')
  })

  it('removes a disputed question from the grade', async () => {
    const response = await remove(2)
    expect(response.status).toBe(200)
    const body = await response.json()
    // MCQ 1 + answers 1, 2, 4, 5 at 2 marks + answer 6 at 1 mark, out of 1 + 5 x 2.
    expect(body).toMatchObject({ total_now: 10, total_max: 11 })
    const again = await remove(2)
    expect(again.status).toBe(409)
    expect((await again.json()).error).toBe('already_removed')
  })

  it('finalises the grade on what is left, and locks it', async () => {
    const finalized = await handlerFor(FinalizeRoute, 'POST')({
      request: call(student.cookie, 'POST'),
      params: { id: attemptId },
    })
    expect(finalized.status).toBe(200)

    const evaluation = await db
      .selectFrom('evaluations')
      .select(['confirmed_at', 'actual_score', 'total_marks', 'percentage'])
      .where('id', '=', evaluationId)
      .executeTakeFirstOrThrow()
    expect(evaluation.confirmed_at).not.toBeNull()
    expect(Number(evaluation.actual_score)).toBe(10)
    expect(Number(evaluation.total_marks)).toBe(11)
    expect(Number(evaluation.percentage)).toBeCloseTo(90.9, 1)

    // The removed question never reaches her mastery record; the other six answers do.
    const logged = await db
      .selectFrom('concept_answer_log')
      .select('paper_question_id')
      .where('evaluation_id', '=', evaluationId)
      .execute()
    expect(logged).toHaveLength(6)
    const removedItem = await db
      .selectFrom('evaluation_items')
      .select(['paper_question_id', 'excluded_by_student'])
      .where('id', '=', itemIds[2])
      .executeTakeFirstOrThrow()
    expect(removedItem.excluded_by_student).toBe(true)
    expect(logged.some((l) => l.paper_question_id === removedItem.paper_question_id)).toBe(false)

    const after = await review()
    expect(after.state).toBe('evaluated')
    const late = await dispute(4)
    expect(late.status).toBe(409)
  })

  it('records the disputes in the audit trail', async () => {
    const rows = await db
      .selectFrom('answer_disputes')
      .select(['marks_before', 'marks_after'])
      .where('evaluation_item_id', 'in', itemIds)
      .execute()
    expect(rows).toHaveLength(5)
    const audit = await db
      .selectFrom('audit_log')
      .select('after')
      .where('entity_id', '=', evaluationId)
      .where('action', '=', 'evaluation.student_finalized')
      .executeTakeFirstOrThrow()
    expect(JSON.stringify(audit.after)).toMatch(/"disputes_used":5/)
    expect(JSON.stringify(audit.after)).toMatch(/"removed":1/)
  })
})
