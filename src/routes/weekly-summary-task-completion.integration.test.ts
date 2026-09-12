import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { createParentSession, createStudentSession } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as StudentsRoute } from './api/students'
import { Route as StudyPlanGenerateRoute } from './api/study-plan/generate'
import { Route as StudyPlanDayRoute } from './api/study-plan/$id/days/$dayNumber'
import { Route as WeeklySummaryRoute } from './api/summary/weekly/$studentId'

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
 * F079: "completion feeds the weekly summary." Generates a real study plan (F077), ticks 2 of its
 * 7 days off via the real PATCH route, then checks the weekly summary for that exact week reports
 * task_completion -- and that a week with no plan at all reports null, not zero.
 */
describe('weekly summary task_completion (F079)', () => {
  let db: Db
  let parent: TestSession
  let student: TestSession
  let studentId: string
  const weekStartStr = mostRecentMonday(new Date()).toISOString().slice(0, 10)

  beforeAll(async () => {
    db = createDb()
    parent = await createParentSession('weeklytask')

    const studentResponse = await handlerFor(
      StudentsRoute,
      'POST',
    )({
      request: request(parent.cookie, {
        name: 'Weekly Task Kid',
        class: 7,
        board: 'CBSE',
        consent_accepted: true,
      }),
    })
    studentId = (await studentResponse.json()).id
    student = await createStudentSession(
      'weeklytask-student',
      parent.householdId,
      studentId,
    )
  })

  afterAll(async () => {
    await db.deleteFrom('study_plans').where('student_id', '=', studentId).execute()
    await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
    await db.destroy()
  })

  it('reports null task_completion when no plan exists yet for that week', async () => {
    const response = await handlerFor(
      WeeklySummaryRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?week_start=${weekStartStr}`, {
        headers: { cookie: parent.cookie },
      }),
      params: { studentId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.task_completion).toBeNull()
  })

  it('reports 2/7 after ticking two days off the generated plan', async () => {
    const generateResponse = await handlerFor(
      StudyPlanGenerateRoute,
      'POST',
    )({ request: request(student.cookie, {}) })
    const planId = (await generateResponse.json()).plan.id

    for (const dayNumber of [1, 2]) {
      await handlerFor(
        StudyPlanDayRoute,
        'PATCH',
      )({
        request: request(student.cookie, { completed: true }),
        params: { id: planId, dayNumber: String(dayNumber) },
      })
    }

    const response = await handlerFor(
      WeeklySummaryRoute,
      'GET',
    )({
      request: new Request(`http://localhost/test?week_start=${weekStartStr}`, {
        headers: { cookie: parent.cookie },
      }),
      params: { studentId },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.task_completion).toEqual({ tasks_completed: 2, tasks_total: 7 })
  })
})
