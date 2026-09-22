import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { chaptersRepository, conceptsRepository } from '../db/repositories'
import { createQuestion } from '../lib/questions'
import {
  createParentSession,
  createStudentSession,
  promoteToAdmin,
} from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { adaptiveLevel } from '../lib/adaptive/levels'
import { POINTS_BY_DIFFICULTY } from '../lib/points'
import { DEFAULT_MASTERY_CONFIG } from '../lib/adaptive/config'
import { Route as StudentsRoute } from './api/students'
import { Route as ProfileRoute } from './api/students/me/profile'
import { Route as GenerateRoute } from './api/papers/generate'
import { Route as AttemptsRoute } from './api/attempts'
import { Route as AttemptAnswerRoute } from './api/attempts/$id/answer'
import { Route as AttemptSubmitRoute } from './api/attempts/$id/submit'
import { Route as AttemptResultRoute } from './api/attempts/$id/result'
import { Route as OverviewRoute } from './api/adaptive/overview'
import { Route as PlanRoute } from './api/adaptive/plan'
import { Route as SettingsRoute } from './api/admin/mastery-settings'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  const handlers = (route.options.server as { handlers: Record<string, RouteHandler> }).handlers
  return handlers[method]
}

function request(cookie: string, body?: unknown, url = 'http://localhost/test'): Request {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function put(cookie: string, body: unknown): Request {
  return new Request('http://localhost/test', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Question grid per concept, one MCQ per adaptive level (see src/lib/adaptive/levels.ts).
const GRID = [
  { level: 1, bloom: 'Remember', difficulty: 'Easy', count: 14 },
  { level: 2, bloom: 'Understand', difficulty: 'Hard', count: 6 },
  { level: 3, bloom: 'Apply', difficulty: 'Hard', count: 6 },
  { level: 4, bloom: 'Apply', difficulty: 'Hardest', count: 4 },
] as const

/**
 * The whole concept-level adaptive loop against the real database: profile setup, an Easy first
 * assessment, marks confirmed straight away for an all-multiple-choice paper, concept-level
 * mastery, per-concept difficulty, weak-concept weighting and retention. Two concepts in ONE
 * chapter (a strong one and a weak one) prove the adaptation is per concept, not per chapter.
 */
describe('concept-level adaptive learning', () => {
  let db: Db
  let parent: TestSession
  let otherParent: TestSession
  let student: TestSession
  let studentId: string
  let retentionStudent: TestSession
  let retentionStudentId: string
  let subjectId: string
  let fixtureSubjectId: string
  let fixtureSubjectCode: string
  let adminSession: TestSession
  let chapterId: string
  let strongConceptId: string
  let weakConceptId: string
  let retentionConceptId: string
  const fixtureTag = `adapt-fixture-${Date.now()}`
  const paperIds: Array<string> = []
  const attemptIds: Array<string> = []
  const conceptIds: Array<string> = []
  let originalConfig: unknown

  async function makeStudent(name: string, prefix: string, session: TestSession) {
    const created = await handlerFor(StudentsRoute, 'POST')({
      request: request(session.cookie, { name, class: 7, board: 'CBSE', consent_accepted: true }),
    })
    const id = (await created.json()).id as string
    const login = await createStudentSession(prefix, session.householdId, id)
    return { id, login }
  }

  async function levelOfQuestion(questionId: string) {
    const q = await db
      .selectFrom('questions')
      .select(['bloom', 'difficulty', 'concept_id'])
      .where('id', '=', questionId)
      .executeTakeFirstOrThrow()
    return { level: adaptiveLevel(q.bloom, q.difficulty), conceptId: q.concept_id }
  }

  // Generates an adaptive paper, answers it (strong concept right, weak concept wrong) and
  // submits. Returns everything the assertions need.
  async function takeTest(session: TestSession) {
    const generated = await handlerFor(GenerateRoute, 'POST')({
      request: request(session.cookie, { adaptive: true, subject_id: subjectId, chapter_ids: [chapterId] }),
    })
    expect(generated.status).toBe(201)
    const body = await generated.json()
    paperIds.push(body.paper.id)

    const attempt = await handlerFor(AttemptsRoute, 'POST')({
      request: request(session.cookie, { paper_id: body.paper.id, mode: 'online' }),
    })
    const attemptId = (await attempt.json()).id as string
    attemptIds.push(attemptId)

    const questions: Array<{ level: number; conceptId: string }> = []
    for (const pq of body.paperQuestions as Array<{ id: string; question_id: string }>) {
      const meta = await levelOfQuestion(pq.question_id)
      questions.push(meta)
      const right = meta.conceptId !== weakConceptId
      await handlerFor(AttemptAnswerRoute, 'PATCH')({
        request: new Request('http://localhost/test', {
          method: 'PATCH',
          headers: { cookie: session.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ paper_question_id: pq.id, selected_option: right ? 'A' : 'B', time_spent_sec: 20 }),
        }),
        params: { id: attemptId },
      })
    }
    const submitted = await handlerFor(AttemptSubmitRoute, 'POST')({
      request: request(session.cookie, {}),
      params: { id: attemptId },
    })
    return { paper: body, attemptId, questions, submit: await submitted.json() }
  }

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('adapt-a')
    otherParent = await createParentSession('adapt-b')

    const main = await makeStudent('Adaptive Kid', 'adapt-student', parent)
    studentId = main.id
    student = main.login
    const second = await makeStudent('Retention Kid', 'adapt-retention', parent)
    retentionStudentId = second.id
    retentionStudent = second.login

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id
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
      name: 'Adaptive fixture chapter',
      order_index: chapterNo,
    })
    chapterId = chapter.id

    const makeConcept = async (suffix: string, name: string) => {
      const concept = await conceptsRepository.insert(db, {
        chapter_id: chapter.id,
        board: 'CBSE',
        class: 7,
        code: `ADAPT-${Date.now()}-${suffix}`,
        name,
        difficulty_base: 'Easy',
      })
      conceptIds.push(concept.id)
      for (const cell of GRID) {
        for (let i = 0; i < cell.count; i++) {
          await createQuestion(db, {
            concept_id: concept.id,
            board: 'CBSE',
            class: 7,
            bloom: cell.bloom,
            difficulty: cell.difficulty,
            marks: 1,
            type: 'mcq',
            text: `${fixtureTag} ${suffix} level ${cell.level} question ${i}`,
            answer: 'A',
            created_by: fixtureTag,
            options: [
              { label: 'A', text: 'right', is_correct: true, order_index: 1 },
              { label: 'B', text: 'wrong', is_correct: false, order_index: 2 },
            ],
          })
        }
      }
      return concept.id
    }
    strongConceptId = await makeConcept('S', 'Adaptive fixture strong concept')
    weakConceptId = await makeConcept('W', 'Adaptive fixture weak concept')
    retentionConceptId = await makeConcept('M', 'Adaptive fixture mastered concept')

    // A visible, active subject the student can choose (deactivated again in afterAll).
    const fixtureSubject = await db
      .insertInto('subjects')
      .values({
        board: 'CBSE',
        class: 7,
        name: `Adaptive fixture subject ${Date.now()}`,
        code: `ADAPT-FX-${Date.now()}`,
        language: 'English',
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    fixtureSubjectId = fixtureSubject.id
    fixtureSubjectCode = fixtureSubject.code

    const admin = await createParentSession('adapt-admin')
    await promoteToAdmin(admin.userId)
    originalConfig = (await (await handlerFor(SettingsRoute, 'GET')({ request: request(admin.cookie) })).json()).config
    adminSession = admin
  })

  afterAll(async () => {
    // Put the shared settings back exactly as they were.
    await handlerFor(SettingsRoute, 'PUT')({ request: put(adminSession.cookie, originalConfig) })
    await db.updateTable('subjects').set({ is_active: false }).where('id', '=', fixtureSubjectId).execute()

    await db.deleteFrom('attempt_answers').where('attempt_id', 'in', attemptIds).execute()
    const evaluations = await db.selectFrom('evaluations').select('id').where('attempt_id', 'in', attemptIds).execute()
    const evaluationIds = evaluations.map((e) => e.id)
    if (evaluationIds.length > 0) {
      await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', evaluationIds).execute()
      await db.deleteFrom('evaluations').where('id', 'in', evaluationIds).execute()
    }
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
    await db.deleteFrom('paper_questions').where('paper_id', 'in', paperIds).execute()
    await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
    await db.deleteFrom('concept_status').where('concept_id', 'in', conceptIds).execute()
    await db.deleteFrom('concept_mastery').where('concept_id', 'in', conceptIds).execute()
    for (const p of [parent, otherParent, adminSession]) {
      await db.deleteFrom('households').where('id', '=', p.householdId).execute()
    }
    await db.deleteFrom('questions').where('created_by', '=', fixtureTag).execute()
    await db.deleteFrom('concepts').where('id', 'in', conceptIds).execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.destroy()
  })

  describe('student profile', () => {
    it('is incomplete for a brand-new student', async () => {
      const response = await handlerFor(ProfileRoute, 'GET')({ request: request(student.cookie) })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.profile.profile_complete).toBe(false)
    })

    it('never offers test fixture subjects, but offers active real ones', async () => {
      const body = await (await handlerFor(ProfileRoute, 'GET')({ request: request(student.cookie) })).json()
      const codes = body.options.flatMap((o: { subjects: Array<{ code: string }> }) => o.subjects.map((s) => s.code))
      expect(codes.some((c: string) => c.endsWith('-SEED'))).toBe(false)
      expect(codes).toContain(fixtureSubjectCode)
    })

    it('rejects an empty subject list and a subject from another class', async () => {
      const none = await handlerFor(ProfileRoute, 'PUT')({
        request: put(student.cookie, { name: 'Adaptive Kid', class: 7, board: 'CBSE', subject_ids: [] }),
      })
      expect(none.status).toBe(400)

      const wrongClass = await handlerFor(ProfileRoute, 'PUT')({
        request: put(student.cookie, { name: 'Adaptive Kid', class: 8, board: 'CBSE', subject_ids: [fixtureSubjectId] }),
      })
      expect(wrongClass.status).toBe(400)
    })

    it('saves, then lets a subject be deselected and selected again', async () => {
      const save = (subjects: Array<string>) =>
        handlerFor(ProfileRoute, 'PUT')({
          request: put(student.cookie, { name: 'Adaptive Kid', class: 7, board: 'CBSE', subject_ids: subjects }),
        })

      const first = await save([fixtureSubjectId])
      expect(first.status).toBe(200)
      const profile = await first.json()
      expect(profile.profile_complete).toBe(true)
      expect(profile.subject_ids).toEqual([fixtureSubjectId])

      const students = await db.selectFrom('students').select('profile_completed_at').where('id', '=', studentId).executeTakeFirstOrThrow()
      expect(students.profile_completed_at).not.toBeNull()

      const other = await db
        .selectFrom('subjects')
        .select('id')
        .where('is_active', '=', true)
        .where('class', '=', 7)
        .where('board', '=', 'CBSE')
        .where('code', 'not like', '%-SEED')
        .where('id', '!=', fixtureSubjectId)
        .executeTakeFirst()
      if (other) {
        const both = await (await save([fixtureSubjectId, other.id])).json()
        expect(both.subject_ids.sort()).toEqual([fixtureSubjectId, other.id].sort())
        const removed = await (await save([other.id])).json()
        expect(removed.subject_ids).toEqual([other.id])
        const row = await db
          .selectFrom('student_subjects')
          .select('is_active')
          .where('student_id', '=', studentId)
          .where('subject_id', '=', fixtureSubjectId)
          .executeTakeFirstOrThrow()
        expect(row.is_active).toBe(false)
      }

      const restored = await (await save([fixtureSubjectId])).json()
      expect(restored.subject_ids).toEqual([fixtureSubjectId])
    })
  })

  describe('first assessment', () => {
    it('recommends a short Easy assessment for a student with no history', async () => {
      const response = await handlerFor(PlanRoute, 'GET')({
        request: request(student.cookie, undefined, `http://localhost/test?subject_id=${subjectId}&chapter_ids=${chapterId}`),
      })
      expect(response.status).toBe(200)
      const plan = await response.json()
      expect(plan.is_initial_assessment).toBe(true)
      expect(plan.difficulty_range).toEqual({ min: 'Easy', max: 'Easy' })
      expect(plan.total_questions).toBe(10)
      expect(plan.question_types).toEqual(['Multiple choice'])
    })

    it('draws only Easy questions, from the concept mix, and confirms marks on submit', async () => {
      const round = await takeTest(student)
      expect(round.questions.length).toBe(10)
      expect(round.questions.every((q) => q.level === 1)).toBe(true)
      expect(new Set(round.questions.map((q) => q.conceptId)).size).toBeGreaterThan(1)

      // Multiple-choice marks come from the key alone, so they are confirmed at once.
      expect(round.submit.evaluation_id).toEqual(expect.any(String))
      const logged = await db
        .selectFrom('concept_answer_log')
        .select(['concept_id', 'credit', 'time_spent_sec'])
        .where('evaluation_id', '=', round.submit.evaluation_id)
        .execute()
      expect(logged.length).toBe(10)
      expect(logged.every((l) => l.time_spent_sec === 20)).toBe(true)

      // F125: points/coins pay out at exactly this same auto-confirm moment, one Easy question's
      // worth (10) per question answered right (the strong concept's questions, per takeTest's
      // own "strong right, weak wrong" rule) -- never for the wrong ones.
      const correctCount = round.questions.filter((q) => q.conceptId !== weakConceptId).length
      expect(round.submit.points_earned).toEqual({
        points: correctCount * POINTS_BY_DIFFICULTY.Easy,
        coins: correctCount * POINTS_BY_DIFFICULTY.Easy,
      })
    })

    it('shows a student her score and concept levels but no answer key', async () => {
      const attemptId = attemptIds[0]
      const response = await handlerFor(AttemptResultRoute, 'GET')({
        request: request(student.cookie),
        params: { id: attemptId },
      })
      const body = await response.json()
      expect(body.evaluated).toBe(true)
      expect(body.total_marks).toBe(10)
      const text = JSON.stringify(body)
      expect(text).not.toMatch(/is_correct|"answer"|correct_option/)
    })
  })

  describe('concept-level mastery and adaptation', () => {
    it('tracks each concept on its own, inside the same chapter', async () => {
      const rows = await db
        .selectFrom('student_concept_performance')
        .selectAll()
        .where('student_id', '=', studentId)
        .where('chapter_id', '=', chapterId)
        .execute()
      const strong = rows.find((r) => r.concept_id === strongConceptId)!
      const weak = rows.find((r) => r.concept_id === weakConceptId)!
      expect(strong.correct_answers).toBe(strong.questions_attempted)
      expect(weak.wrong_answers).toBe(weak.questions_attempted)
      expect(Number(strong.mastery_score)).toBeGreaterThan(Number(weak.mastery_score))
      expect(strong.subject_id).toBe(subjectId)
      expect(strong.avg_response_sec).toBe(20)
    })

    it('never calls a concept Mastered after a single test', async () => {
      const rows = await db
        .selectFrom('student_concept_performance')
        .select(['mastery_level', 'evidence_met', 'evidence_blockers'])
        .where('student_id', '=', studentId)
        .where('concept_id', '=', strongConceptId)
        .executeTakeFirstOrThrow()
      expect(rows.mastery_level).not.toBe('Mastered')
      expect(rows.evidence_met).toBe(false)
      expect(JSON.stringify(rows.evidence_blockers)).toMatch(/separate tests/)
    })

    it('raises difficulty for the strong concept only', async () => {
      const level = async (conceptId: string) =>
        (
          await db
            .selectFrom('student_concept_performance')
            .select('current_difficulty')
            .where('student_id', '=', studentId)
            .where('concept_id', '=', conceptId)
            .executeTakeFirstOrThrow()
        ).current_difficulty
      expect(await level(strongConceptId)).toBeGreaterThanOrEqual(2)
      expect(await level(weakConceptId)).toBe(1)
    })

    it('keeps an auditable history of every score', async () => {
      const history = await db
        .selectFrom('mastery_history')
        .select(['mastery_score', 'components'])
        .where('student_id', '=', studentId)
        .where('concept_id', '=', strongConceptId)
        .execute()
      expect(history.length).toBe(1)
      expect(JSON.stringify(history[0].components)).toMatch(/accuracy/)
    })

    it('gives the weak concept more of the next paper than the strong one', async () => {
      const response = await handlerFor(PlanRoute, 'GET')({
        request: request(student.cookie, undefined, `http://localhost/test?subject_id=${subjectId}&chapter_ids=${chapterId}`),
      })
      const plan = await response.json()
      expect(plan.is_initial_assessment).toBe(false)
      const planned = (id: string) =>
        plan.concepts.find((c: { concept_id: string }) => c.concept_id === id).questions_planned as number
      expect(planned(weakConceptId)).toBeGreaterThan(planned(strongConceptId))
      expect(plan.total_questions).toBe(12)
    })

    it('draws harder questions for the strong concept and Easy for the weak one', async () => {
      const round = await takeTest(student)
      const weakLevels = round.questions.filter((q) => q.conceptId === weakConceptId).map((q) => q.level)
      const strongLevels = round.questions.filter((q) => q.conceptId === strongConceptId).map((q) => q.level)
      expect(weakLevels.length).toBeGreaterThan(strongLevels.length)
      expect(weakLevels.every((l) => l === 1)).toBe(true)
      expect(strongLevels.every((l) => l <= 2)).toBe(true)
      expect(Math.max(...strongLevels)).toBeGreaterThanOrEqual(1)
    })

    it('records a second separate test for the same concept', async () => {
      const row = await db
        .selectFrom('student_concept_performance')
        .select(['assessment_count', 'questions_attempted'])
        .where('student_id', '=', studentId)
        .where('concept_id', '=', strongConceptId)
        .executeTakeFirstOrThrow()
      expect(row.assessment_count).toBe(2)
    })
  })

  describe('dashboard overview', () => {
    it('lists selected subjects with concept mastery, and a recommended next', async () => {
      await db
        .insertInto('student_subjects')
        .values({ student_id: studentId, subject_id: subjectId })
        .onConflict((oc) => oc.doNothing())
        .execute()
      const response = await handlerFor(OverviewRoute, 'GET')({ request: request(student.cookie) })
      expect(response.status).toBe(200)
      const overview = await response.json()
      expect(overview.student.name).toBe('Adaptive Kid')
      expect(overview.subjects.length).toBe(2)
      const withContent = overview.subjects.find((s: { has_content: boolean }) => s.has_content)
      const concepts = withContent.chapters.flatMap((c: { concepts: Array<{ concept_id: string; mastery_level: string }> }) => c.concepts)
      const strong = concepts.find((c: { concept_id: string }) => c.concept_id === strongConceptId)
      const weak = concepts.find((c: { concept_id: string }) => c.concept_id === weakConceptId)
      expect(strong.mastery_level).not.toBe('Not started')
      expect(['Beginner', 'Developing']).toContain(weak.mastery_level)
      expect(overview.recommended_next).not.toBeNull()
      expect(overview.needs_improvement.some((c: { concept_id: string }) => c.concept_id === weakConceptId)).toBe(true)

      // A video the admin attached to the weak concept is offered to the student.
      await db
        .updateTable('concepts')
        .set({ video_url: 'https://www.youtube.com/watch?v=fixture', video_title: 'Fixture video' })
        .where('id', '=', weakConceptId)
        .execute()
      const again = await (await handlerFor(OverviewRoute, 'GET')({ request: request(student.cookie) })).json()
      const weakItem = again.needs_improvement.find((c: { concept_id: string }) => c.concept_id === weakConceptId)
      expect(weakItem).toMatchObject({ video_url: 'https://www.youtube.com/watch?v=fixture', video_title: 'Fixture video' })
      const weakConcept = again.subjects
        .flatMap((s: { chapters: Array<{ concepts: Array<{ concept_id: string; video_url: string | null }> }> }) => s.chapters)
        .flatMap((c: { concepts: Array<{ concept_id: string; video_url: string | null }> }) => c.concepts)
        .find((c: { concept_id: string }) => c.concept_id === weakConceptId)
      expect(weakConcept.video_url).toBe('https://www.youtube.com/watch?v=fixture')
      const noContent = overview.subjects.find((s: { has_content: boolean }) => !s.has_content)
      expect(noContent).toBeTruthy()
    })

    it('needs a student_id from a parent and stays inside the household', async () => {
      const missing = await handlerFor(OverviewRoute, 'GET')({ request: request(parent.cookie) })
      expect(missing.status).toBe(400)

      const own = await handlerFor(OverviewRoute, 'GET')({
        request: request(parent.cookie, undefined, `http://localhost/test?student_id=${studentId}`),
      })
      expect(own.status).toBe(200)

      const foreign = await handlerFor(OverviewRoute, 'GET')({
        request: request(otherParent.cookie, undefined, `http://localhost/test?student_id=${studentId}`),
      })
      expect(foreign.status).toBe(404)
    })
  })

  describe('retention', () => {
    it('keeps a due mastered concept in the next paper', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
      await db
        .insertInto('student_concept_performance')
        .values({
          student_id: retentionStudentId,
          concept_id: retentionConceptId,
          subject_id: subjectId,
          chapter_id: chapterId,
          mastery_score: 95,
          mastery_level: 'Mastered',
          questions_attempted: 20,
          correct_answers: 19,
          wrong_answers: 1,
          accuracy: 95,
          recent_accuracy: 100,
          current_difficulty: 4,
          assessment_count: 3,
          last_assessed_at: past,
          retention_status: 'scheduled',
          next_retention_at: past,
          evidence_met: true,
        })
        .execute()
      const response = await handlerFor(PlanRoute, 'GET')({
        request: request(retentionStudent.cookie, undefined, `http://localhost/test?subject_id=${subjectId}&chapter_ids=${chapterId}`),
      })
      const plan = await response.json()
      const mastered = plan.concepts.find((c: { concept_id: string }) => c.concept_id === retentionConceptId)
      expect(mastered.questions_planned).toBeGreaterThanOrEqual(1)
      expect(mastered.reasons).toContain('retention check due')
      const others = plan.concepts.filter((c: { concept_id: string }) => c.concept_id !== retentionConceptId)
      expect(Math.max(...others.map((c: { questions_planned: number }) => c.questions_planned))).toBeGreaterThan(
        mastered.questions_planned,
      )
    })
  })

  describe('admin settings', () => {
    it('rejects a student and unauthenticated callers', async () => {
      expect((await handlerFor(SettingsRoute, 'GET')({ request: request(student.cookie) })).status).toBe(403)
      expect((await handlerFor(SettingsRoute, 'GET')({ request: request('') })).status).toBe(401)
    })

    it('rejects weights that do not add up and thresholds that do not increase', async () => {
      const badWeights = await handlerFor(SettingsRoute, 'PUT')({
        request: put(adminSession.cookie, { weights: { accuracy: 0.9 } }),
      })
      expect(badWeights.status).toBe(400)
      const badLevels = await handlerFor(SettingsRoute, 'PUT')({
        request: put(adminSession.cookie, { levels: { proficient: 95 } }),
      })
      expect(badLevels.status).toBe(400)
    })

    it('saves a change, applies it, and reports the defaults', async () => {
      const saved = await handlerFor(SettingsRoute, 'PUT')({
        request: put(adminSession.cookie, { evidence: { minQuestions: 12 } }),
      })
      expect(saved.status).toBe(200)
      const fresh = await (await handlerFor(SettingsRoute, 'GET')({ request: request(adminSession.cookie) })).json()
      expect(fresh.config.evidence.minQuestions).toBe(12)
      expect(fresh.defaults.evidence.minQuestions).toBe(DEFAULT_MASTERY_CONFIG.evidence.minQuestions)
    })
  })
})
