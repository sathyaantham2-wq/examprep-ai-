import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  blueprintsRepository,
  studentsRepository,
  attemptsRepository,
  attemptAnswersRepository,
} from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { generatePaper } from '../lib/papers'
import { createEvaluation } from '../lib/evaluation'
import {
  createParentSession,
  createStudentSession,
  promoteToAdmin,
} from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as ReportRoute } from './api/attempts/$id/report'
import { Route as AdminReportsRoute } from './api/admin/question-reports'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(
  route: { options: { server?: unknown } },
  method: string,
): RouteHandler {
  return (route.options.server as { handlers: Record<string, RouteHandler> })
    .handlers[method]
}

function req(cookie: string, method: string, body?: unknown, url = 'http://localhost/test'): Request {
  return new Request(url, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * F129: spelling-tolerant fill-in-the-blank marking, end to end through the real evaluation, and
 * the student "Report a problem" flow -- own attempt only, one report per question, and an admin
 * only ever sees her own household's reports (T02).
 */
describe('F129: spelling tolerance and question reports', () => {
  let db: Db
  let parentA: TestSession
  let parentB: TestSession
  let student: TestSession
  let otherStudent: TestSession
  let studentId: string
  let otherStudentId: string
  let chapterId: string
  let conceptId: string
  let blueprintId: string
  let paperId: string
  let paperQuestionId: string
  let attemptId: string
  let evaluationId: string

  beforeAll(async () => {
    db = createDb()
    parentA = await createParentSession('reports-a')
    parentB = await createParentSession('reports-b')
    await promoteToAdmin(parentA.userId)
    await promoteToAdmin(parentB.userId)
    // Re-sign-in is not needed: role is read from the database on every request.

    studentId = (
      await studentsRepository.insert(db, {
        household_id: parentA.householdId,
        name: 'Report Kid',
        class: 7,
        board: 'CBSE',
        target_exams: JSON.stringify([]),
      })
    ).id
    student = await createStudentSession('reports-kid', parentA.householdId, studentId)
    otherStudentId = (
      await studentsRepository.insert(db, {
        household_id: parentB.householdId,
        name: 'Other Kid',
        class: 7,
        board: 'CBSE',
        target_exams: JSON.stringify([]),
      })
    ).id
    otherStudent = await createStudentSession('reports-other', parentB.householdId, otherStudentId)

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
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
        name: 'Reports fixture chapter',
        order_index: 9000,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    chapterId = chapter.id
    conceptId = (
      await conceptsRepository.insert(db, {
        chapter_id: chapter.id,
        board: 'CBSE',
        class: 7,
        code: `C7M-1.RP-${Date.now()}`,
        name: 'Reports fixture concept',
        difficulty_base: 'Easy',
      })
    ).id
    await createQuestion(db, {
      concept_id: conceptId,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'fill_blank',
      text: 'Green plants make their food by ____.',
      answer: 'photosynthesis',
      created_by: 'reports-fixture',
    })
    blueprintId = (
      await blueprintsRepository.insert(db, {
        subject_id: subject.id,
        board: 'CBSE',
        class: 7,
        name: 'Reports fixture blueprint',
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
    ).id
    const generated = await generatePaper(db, {
      student_id: studentId,
      blueprint_id: blueprintId,
      chapter_ids: [chapter.id],
    })
    paperId = generated.paper.id
    paperQuestionId = generated.paperQuestions[0].id

    attemptId = (
      await attemptsRepository.insert(db, {
        paper_id: paperId,
        student_id: studentId,
        mode: 'online',
        status: 'in_progress',
      })
    ).id
    // Right word, wrong spelling.
    await attemptAnswersRepository.upsert(db, {
      attempt_id: attemptId,
      paper_question_id: paperQuestionId,
      response_text: 'photosynthsis',
      source: 'typed',
    })
    await attemptsRepository.update(db, studentId, attemptId, {
      status: 'submitted',
      submitted_at: new Date(),
      duration_used_sec: 30,
    })
    evaluationId = (await createEvaluation(db, attemptId)).evaluation.id
  })

  afterAll(async () => {
    await db.deleteFrom('question_reports').where('attempt_id', '=', attemptId).execute()
    await db.deleteFrom('evaluation_items').where('evaluation_id', '=', evaluationId).execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db.deleteFrom('attempt_answers').where('attempt_id', '=', attemptId).execute()
    await db.deleteFrom('attempts').where('id', '=', attemptId).execute()
    await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [parentA.householdId, parentB.householdId])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('created_by', '=', 'reports-fixture').execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.destroy()
  })

  it('a misspelled but recognisable fill-in-the-blank answer earns full marks', async () => {
    const item = await db
      .selectFrom('evaluation_items')
      .select(['marks_awarded', 'marks_max'])
      .where('evaluation_id', '=', evaluationId)
      .executeTakeFirstOrThrow()
    expect(Number(item.marks_awarded)).toBe(Number(item.marks_max))
  })

  it('a student reports a question on her own attempt, once', async () => {
    const post = handlerFor(ReportRoute, 'POST')
    const body = {
      paper_question_id: paperQuestionId,
      reason: 'marked_wrong',
      comment: 'Only my spelling was different.',
    }
    const first = await post({ request: req(student.cookie, 'POST', body), params: { id: attemptId } })
    expect(first.status).toBe(201)
    const again = await post({ request: req(student.cookie, 'POST', body), params: { id: attemptId } })
    expect(again.status).toBe(409)

    const list = await handlerFor(ReportRoute, 'GET')({
      request: req(student.cookie, 'GET'),
      params: { id: attemptId },
    })
    expect((await list.json()).reported).toEqual([paperQuestionId])
  })

  it('rejects a too-short comment and a question that is not on the paper', async () => {
    const post = handlerFor(ReportRoute, 'POST')
    const short = await post({
      request: req(student.cookie, 'POST', {
        paper_question_id: paperQuestionId,
        reason: 'unclear',
        comment: 'x',
      }),
      params: { id: attemptId },
    })
    expect(short.status).toBe(400)
    const notOnPaper = await post({
      request: req(student.cookie, 'POST', {
        paper_question_id: crypto.randomUUID(),
        reason: 'unclear',
        comment: 'This is unclear.',
      }),
      params: { id: attemptId },
    })
    expect(notOnPaper.status).toBe(404)
  })

  it("a student from another household cannot report on (or see) someone else's attempt", async () => {
    const post = await handlerFor(ReportRoute, 'POST')({
      request: req(otherStudent.cookie, 'POST', {
        paper_question_id: paperQuestionId,
        reason: 'other',
        comment: 'Trying to report.',
      }),
      params: { id: attemptId },
    })
    expect(post.status).toBe(404)
    const get = await handlerFor(ReportRoute, 'GET')({
      request: req(otherStudent.cookie, 'GET'),
      params: { id: attemptId },
    })
    expect(get.status).toBe(404)
  })

  it('an admin sees only her own household reports, and can resolve them (T02)', async () => {
    const list = handlerFor(AdminReportsRoute, 'GET')
    const own = await (await list({ request: req(parentA.cookie, 'GET') })).json()
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({
      reason: 'marked_wrong',
      expected_answer: 'photosynthesis',
      student_answer: 'photosynthsis',
    })

    const other = await (await list({ request: req(parentB.cookie, 'GET') })).json()
    expect(other).toHaveLength(0)

    const patch = handlerFor(AdminReportsRoute, 'PATCH')
    const foreign = await patch({
      request: req(parentB.cookie, 'PATCH', { id: own[0].id, status: 'resolved' }),
    })
    expect(foreign.status).toBe(404)
    const mine = await patch({
      request: req(parentA.cookie, 'PATCH', { id: own[0].id, status: 'resolved' }),
    })
    expect(mine.status).toBe(200)
    const open = await (await list({ request: req(parentA.cookie, 'GET') })).json()
    expect(open).toHaveLength(0)
  })

  it('a student cannot read the admin report queue', async () => {
    const response = await handlerFor(AdminReportsRoute, 'GET')({
      request: req(student.cookie, 'GET'),
    })
    expect(response.status).toBe(403)
  })
})
