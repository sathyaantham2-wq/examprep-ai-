import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../../db/connection'
import type { Db } from '../../db/connection'
import { chaptersRepository, conceptsRepository } from '../../db/repositories'
import { createQuestion } from '../questions'
import { createParentSession, createStudentSession } from '../../db/test-helpers'
import type { TestSession } from '../../db/test-helpers'
import { getWrongQuestionsForConcept } from './wrong-questions'
import { Route as StudentsRoute } from '../../routes/api/students'
import { Route as GenerateRoute } from '../../routes/api/papers/generate'
import { Route as AttemptsRoute } from '../../routes/api/attempts'
import { Route as AttemptAnswerRoute } from '../../routes/api/attempts/$id/answer'
import { Route as AttemptSubmitRoute } from '../../routes/api/attempts/$id/submit'
import { Route as WrongQuestionsRoute } from '../../routes/api/adaptive/concepts/$conceptId/wrong-questions'

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

/**
 * F123-follow-up (2026-09-24): the concept tracker's "where are the wrong questions" feature.
 * Drives a real all-MCQ paper end to end (generate, answer, submit -- confirmed at once, same as
 * the adaptive-flow e2e spec) with a deliberate mix of right and wrong answers, then checks that
 * getWrongQuestionsForConcept and its route both surface exactly the wrong ones, with the correct
 * answer next to what she actually picked, and never the questions she got right.
 */
describe('getWrongQuestionsForConcept', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let chapterId: string
  let conceptId: string
  let attemptId = ''
  const tag = `wrongq-${Date.now()}`
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('wrongq-parent')

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
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
      name: 'Wrong-questions fixture chapter',
      order_index: chapterNo,
    })
    chapterId = chapter.id
    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `WRONGQ-${Date.now()}`,
      name: 'Wrong-questions fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    // 4 distinct questions, each with its own right/wrong option text, so the test can tell which
    // question a "wrong" result came from just by its text -- and so two questions never
    // accidentally share the same correct-answer text.
    for (let i = 0; i < 4; i++) {
      await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `${tag} question ${i}`,
        answer: 'A',
        created_by: tag,
        options: [
          { label: 'A', text: `right answer ${i}`, is_correct: true, order_index: 1 },
          { label: 'B', text: `wrong answer ${i}`, is_correct: false, order_index: 2 },
        ],
      })
    }

    const created = await handlerFor(StudentsRoute, 'POST')({
      request: call(parent.cookie, 'POST', { name: 'Wrong Q Kid', class: 7, board: 'CBSE', consent_accepted: true }),
    })
    studentId = (await created.json()).id
    student = await createStudentSession('wrongq-student', parent.householdId, studentId)

    // Adaptive mode (not a blueprint) -- confirmMarks-at-submit for an all-MCQ paper only happens
    // for adaptive practice (weighting.adaptive.enabled on the paper row, checked by
    // autoConfirmAttempt); a plain blueprint-generated paper always waits for a parent, per
    // CLAUDE.md's hard rule, which would leave concept_answer_log empty for this test.
    const generated = await handlerFor(GenerateRoute, 'POST')({
      request: call(student.cookie, 'POST', {
        adaptive: true,
        subject_id: subject.id,
        chapter_ids: [chapterId],
        adaptive_question_count: 4,
        adaptive_question_type: 'mcq',
        recent_usage_window_days: 0,
      }),
    })
    const paper = await generated.json()
    expect(paper.paperQuestions).toHaveLength(4)
    paperIds.push(paper.paper.id)

    const attempt = await handlerFor(AttemptsRoute, 'POST')({
      request: call(student.cookie, 'POST', { paper_id: paper.paper.id, mode: 'online' }),
    })
    attemptId = (await attempt.json()).id
    attemptIds.push(attemptId)

    // Questions 0 and 2 answered correctly (A); 1 and 3 answered wrong (B) -- so exactly two of
    // the four should come back from getWrongQuestionsForConcept.
    const paperQuestions = paper.paperQuestions as Array<{ id: string; question_id: string }>
    const questionRows = await db
      .selectFrom('questions')
      .select(['id', 'text'])
      .where(
        'id',
        'in',
        paperQuestions.map((pq) => pq.question_id),
      )
      .execute()
    const textByQuestionId = new Map(questionRows.map((q) => [q.id, q.text]))
    for (const pq of paperQuestions) {
      const text = textByQuestionId.get(pq.question_id) ?? ''
      const wantsWrong = text.endsWith(' 1') || text.endsWith(' 3')
      await handlerFor(AttemptAnswerRoute, 'PATCH')({
        request: call(student.cookie, 'PATCH', {
          paper_question_id: pq.id,
          selected_option: wantsWrong ? 'B' : 'A',
        }),
        params: { id: attemptId },
      })
    }

    const submitted = await (
      await handlerFor(AttemptSubmitRoute, 'POST')({
        request: call(student.cookie, 'POST'),
        params: { id: attemptId },
      })
    ).json()
    // All-MCQ: marked at once, no parent review step (CLAUDE.md's 2026-09-20 exception).
    expect(submitted.review_pending).toBeFalsy()
  })

  afterAll(async () => {
    // Every "in (...)" delete below is guarded against an empty id array -- an empty IN list is a
    // Postgres syntax error, not zero matched rows, and this suite's whole point is a case where
    // (before the fix) evaluationIds legitimately came back empty.
    const evaluations = await db.selectFrom('evaluations').select('id').where('attempt_id', 'in', attemptIds).execute()
    const evaluationIds = evaluations.map((e) => e.id)
    if (evaluationIds.length > 0) {
      await db.deleteFrom('concept_answer_log').where('evaluation_id', 'in', evaluationIds).execute()
      await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', evaluationIds).execute()
      await db.deleteFrom('evaluations').where('id', 'in', evaluationIds).execute()
    }
    if (attemptIds.length > 0) {
      await db.deleteFrom('attempt_answers').where('attempt_id', 'in', attemptIds).execute()
      await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    }
    if (paperIds.length > 0) {
      await db.deleteFrom('paper_questions').where('paper_id', 'in', paperIds).execute()
      await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    }
    await db.deleteFrom('concept_status').where('concept_id', '=', conceptId).execute()
    await db.deleteFrom('concept_mastery').where('concept_id', '=', conceptId).execute()
    await db.deleteFrom('student_concept_performance').where('concept_id', '=', conceptId).execute()
    await db.deleteFrom('mastery_history').where('concept_id', '=', conceptId).execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.deleteFrom('questions').where('created_by', '=', tag).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.destroy()
  })

  it('returns only the questions she got wrong, with the correct answer next to hers', async () => {
    const wrong = await getWrongQuestionsForConcept(db, { studentId, conceptId })
    expect(wrong).toHaveLength(2)
    const texts = wrong.map((w) => w.text).sort()
    expect(texts).toEqual([`${tag} question 1`, `${tag} question 3`])
    for (const w of wrong) {
      expect(w.marks_awarded).toBe(0)
      expect(w.marks_max).toBe(1)
      expect(w.her_answer).toMatch(/^B\. wrong answer/)
      expect(w.correct_answer).toMatch(/^A\. right answer/)
    }
    // Never one of the questions she got right.
    expect(texts).not.toContain(`${tag} question 0`)
    expect(texts).not.toContain(`${tag} question 2`)
  })

  it('the route requires her own session and returns the same data', async () => {
    const unauth = await handlerFor(WrongQuestionsRoute, 'GET')({
      request: new Request('http://localhost/test'),
      params: { conceptId },
    })
    expect(unauth.status).toBe(401)

    const response = await handlerFor(WrongQuestionsRoute, 'GET')({
      request: call(student.cookie, 'GET'),
      params: { conceptId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.questions).toHaveLength(2)
  })
})
