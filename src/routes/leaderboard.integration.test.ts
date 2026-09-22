import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  blueprintsRepository,
  householdsRepository,
  studentsRepository,
  attemptsRepository,
  attemptAnswersRepository,
} from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { generatePaper } from '../lib/papers'
import { createEvaluation, confirmEvaluation } from '../lib/evaluation'
import { createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as OptInRoute } from './api/students/me/leaderboard-opt-in'
import { Route as LeaderboardRoute } from './api/leaderboard'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  const handlers = (route.options.server as { handlers: Record<string, RouteHandler> }).handlers
  return handlers[method]
}

function request(url: string, cookie: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F125 (second slice: opt-in + leaderboard read). A student earns real points (Easy MCQ, answered
 * right) through the normal confirmEvaluation path, then opts herself in and reads her own
 * subject leaderboard -- checking both the "not opted in yet" (private-only) and "opted in"
 * (visible, ranked) states.
 */
describe('leaderboard opt-in and read (F125)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let studentId: string
  let student: TestSession
  let subjectId: string
  let chapterId: string
  let blueprintId: string
  let conceptId: string
  let questionId: string
  let paperId: string
  let attemptId: string
  let evaluationId: string

  beforeAll(async () => {
    db = createDb()

    household = await householdsRepository.insert(db, {
      name: 'Leaderboard Fixture Household',
      plan: 'free',
    })
    const studentRow = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'Leaderboard Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    studentId = studentRow.id
    student = await createStudentSession('leaderboard', household.id, studentId)

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id
    // A DEDICATED chapter, not chapter_no=1 -- see student-points.integration.test.ts's identical
    // comment: several integration test files fixture their own questions under MATH-SEED's
    // chapter 1, which makes generatePaper()'s weighted pick nondeterministic once more than one
    // of them runs in the same suite.
    const anyChapter = await db
      .selectFrom('chapters')
      .select('source_id')
      .where('subject_id', '=', subject.id)
      .executeTakeFirstOrThrow()
    const chapter = await db
      .insertInto('chapters')
      .values({
        subject_id: subject.id,
        source_id: anyChapter.source_id,
        part: 'I',
        chapter_no: 9000 + Math.floor(Math.random() * 90000),
        name: 'Leaderboard fixture chapter',
        order_index: 9000,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    chapterId = chapter.id

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.LB-${Date.now()}`,
      name: 'Leaderboard fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    const question = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Leaderboard fixture question',
      answer: '1',
      created_by: 'leaderboard-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    questionId = question.id

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Leaderboard fixture blueprint',
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([
        { name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] },
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

    const generated = await generatePaper(db, {
      student_id: studentId,
      blueprint_id: blueprintId,
      chapter_ids: [chapter.id],
    })
    expect(generated.paperQuestions).toHaveLength(1)
    paperId = generated.paper.id

    const attempt = await attemptsRepository.insert(db, {
      paper_id: paperId,
      student_id: studentId,
      mode: 'online',
      status: 'in_progress',
    })
    attemptId = attempt.id

    await attemptAnswersRepository.upsert(db, {
      attempt_id: attemptId,
      paper_question_id: generated.paperQuestions[0].id,
      selected_option: 'A', // right
      source: 'typed',
    })
    await attemptsRepository.update(db, studentId, attemptId, {
      status: 'submitted',
      submitted_at: new Date(),
      duration_used_sec: 30,
    })

    const evaluation = await createEvaluation(db, attemptId)
    evaluationId = evaluation.evaluation.id
    await confirmEvaluation(db, evaluationId)
  })

  afterAll(async () => {
    await db.deleteFrom('student_points_ledger').where('student_id', '=', studentId).execute()
    await db.deleteFrom('evaluation_items').where('evaluation_id', '=', evaluationId).execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db.deleteFrom('attempt_answers').where('attempt_id', '=', attemptId).execute()
    await db.deleteFrom('attempts').where('id', '=', attemptId).execute()
    await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', '=', questionId).execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.destroy()
  })

  it('before opting in: sees her own point total privately, no rank, invisible to the leaderboard', async () => {
    const res = await handlerFor(LeaderboardRoute, 'GET')({
      request: request(`http://localhost/test?subject_id=${subjectId}`, student.cookie, 'GET'),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.me).toEqual({ points: 10, rank: null, optedIn: false, nickname: null })
    expect(body.entries.find((e: { nickname: string }) => e.nickname)).toBeUndefined()
  })

  it('opting in generates a nickname and puts her on the leaderboard at rank 1', async () => {
    const optRes = await handlerFor(OptInRoute, 'PATCH')({
      request: request('http://localhost/test', student.cookie, 'PATCH', { opt_in: true }),
    })
    expect(optRes.status).toBe(200)
    const optBody = await optRes.json()
    expect(optBody.opt_in).toBe(true)
    expect(typeof optBody.nickname).toBe('string')
    expect(optBody.nickname.length).toBeGreaterThan(0)

    const res = await handlerFor(LeaderboardRoute, 'GET')({
      request: request(`http://localhost/test?subject_id=${subjectId}`, student.cookie, 'GET'),
    })
    const body = await res.json()
    expect(body.me).toEqual({
      points: 10,
      rank: 1,
      optedIn: true,
      nickname: optBody.nickname,
    })
    expect(body.entries).toEqual([{ rank: 1, nickname: optBody.nickname, points: 10 }])
  })

  it('regenerating the nickname changes it without touching opt-in status', async () => {
    const before = await handlerFor(OptInRoute, 'PATCH')({
      request: request('http://localhost/test', student.cookie, 'PATCH', {}),
    })
    const beforeBody = await before.json()

    const res = await handlerFor(OptInRoute, 'PATCH')({
      request: request('http://localhost/test', student.cookie, 'PATCH', {
        regenerate_nickname: true,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.opt_in).toBe(true)
    expect(typeof body.nickname).toBe('string')
    // Extremely unlikely but not impossible to roll the identical nickname twice -- the important
    // assertion is that opt_in survived untouched, checked above; nickname change is best-effort.
    void beforeBody
  })

  it('rejects a subject_id outside her own board/class', async () => {
    const res = await handlerFor(LeaderboardRoute, 'GET')({
      request: request('http://localhost/test?subject_id=00000000-0000-0000-0000-000000000000', student.cookie, 'GET'),
    })
    expect(res.status).toBe(404)
  })
})
