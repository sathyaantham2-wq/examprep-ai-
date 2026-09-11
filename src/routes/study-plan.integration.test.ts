import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  conceptStatusRepository,
  studyPlansRepository,
} from '../db/repositories'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudyPlanRoute } from './api/study-plan'
import { Route as StudyPlanGenerateRoute } from './api/study-plan/generate'

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

function mostRecentMonday(from: Date): Date {
  const day = from.getUTCDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(from)
  monday.setUTCDate(from.getUTCDate() - diffToMonday)
  monday.setUTCHours(0, 0, 0, 0)
  return monday
}

/**
 * F077: "Plan built from current weak/priority concepts and upcoming exam dates: 7 rows of
 * subject + concept + activity, regenerable."
 */
describe('7-day study plan generator (F077)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  let conceptPriorityId: string
  let conceptWeakId: string

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('studyplan')

    const weekStart = mostRecentMonday(new Date())
    const examDate = new Date(weekStart)
    examDate.setUTCDate(weekStart.getUTCDate() + 6) // Sunday of this week -> day 7

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Study Plan Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
        target_exams: [
          { name: 'Unit Test', date: examDate.toISOString().slice(0, 10) },
        ],
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'studyplan-student',
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

    const conceptPriority = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.PLAN-PRIORITY-${Date.now()}`,
      name: 'Study plan fixture concept (Priority)',
      difficulty_base: 'Easy',
    })
    conceptPriorityId = conceptPriority.id
    await conceptStatusRepository.upsert(db, {
      student_id: studentId,
      concept_id: conceptPriorityId,
      status: 'Priority',
    })

    const conceptWeak = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.PLAN-WEAK-${Date.now()}`,
      name: 'Study plan fixture concept (Weak)',
      difficulty_base: 'Easy',
    })
    conceptWeakId = conceptWeak.id
    await conceptStatusRepository.upsert(db, {
      student_id: studentId,
      concept_id: conceptWeakId,
      status: 'Weak',
    })
  })

  afterAll(async () => {
    await db.deleteFrom('study_plans').where('student_id', '=', studentId).execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db
      .deleteFrom('concepts')
      .where('id', 'in', [conceptPriorityId, conceptWeakId])
      .execute()
    await db.destroy()
  })

  it('returns null before any plan has been generated', async () => {
    const response = await handlerFor(
      StudyPlanRoute,
      'GET',
    )({ request: request(student.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.plan).toBeNull()
  })

  let firstPlanId: string

  it('generates a 7-day plan cycling through Priority/Weak concepts, worst first', async () => {
    const response = await handlerFor(
      StudyPlanGenerateRoute,
      'POST',
    )({ request: request(student.cookie, {}) })
    expect(response.status).toBe(201)
    const body = await response.json()
    firstPlanId = body.plan.id
    expect(body.plan.status).toBe('active')
    expect(body.plan.days).toHaveLength(7)

    // Priority (worse) fills day 1, Weak fills day 2, then cycles: day 3 -> Priority again.
    expect(body.plan.days[0].concept_id).toBe(conceptPriorityId)
    expect(body.plan.days[1].concept_id).toBe(conceptWeakId)
    expect(body.plan.days[2].concept_id).toBe(conceptPriorityId)

    // Day 7 lands on the exam date seeded in beforeAll -- its activity names the exam.
    expect(body.plan.days[6].activity).toContain('Unit Test')
  })

  it('GET now returns the generated plan', async () => {
    const response = await handlerFor(
      StudyPlanRoute,
      'GET',
    )({ request: request(student.cookie) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.plan.id).toBe(firstPlanId)
  })

  it('regenerating the same week updates that row in place (student_id, week_start is unique) rather than erroring', async () => {
    const response = await handlerFor(
      StudyPlanGenerateRoute,
      'POST',
    )({ request: request(student.cookie, {}) })
    expect(response.status).toBe(201)
    const body = await response.json()
    // Same row, refreshed -- (student_id, week_start) is unique regardless of status, so a
    // same-week regenerate cannot insert a second row without violating that constraint.
    expect(body.plan.id).toBe(firstPlanId)
    expect(body.plan.status).toBe('active')

    const activeCount = await db
      .selectFrom('study_plans')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('student_id', '=', studentId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow()
    expect(Number(activeCount.count)).toBe(1)
  })

  it("a stale 'active' plan from an earlier week is superseded when a new week's plan is generated", async () => {
    const staleWeek = await studyPlansRepository.insert(db, {
      student_id: studentId,
      week_start: '2020-01-06', // a Monday, long before any test actually runs
      days: JSON.stringify([]),
      status: 'active',
    })

    await handlerFor(
      StudyPlanGenerateRoute,
      'POST',
    )({ request: request(student.cookie, {}) })

    const refreshed = await db
      .selectFrom('study_plans')
      .select('status')
      .where('id', '=', staleWeek.id)
      .executeTakeFirstOrThrow()
    expect(refreshed.status).toBe('superseded')
  })

  it("a parent must name student_id, and another household can't reach it", async () => {
    const noStudentId = await handlerFor(
      StudyPlanRoute,
      'GET',
    )({ request: request(parent.cookie) })
    expect(noStudentId.status).toBe(400)

    const otherParent = await createParentSession('studyplan-other')
    const response = await handlerFor(
      StudyPlanRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?student_id=${studentId}`, {
        headers: { cookie: otherParent.cookie },
      }),
    })
    expect(response.status).toBe(404)
    await db.deleteFrom('households').where('id', '=', otherParent.householdId).execute()
  })
})
