import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../../lib/session'
import { resolveEnabledStudent } from '../../../../../lib/access'
import { setDayCompleted } from '../../../../../lib/study-plan'
import { getSharedDb } from '../../../../../db/connection'
import { wrapRouteHandlers } from '../../../../../lib/error-log'

const requestSchema = z.object({
  completed: z.boolean(),
})

/**
 * F079: PATCH /api/study-plan/:id/days/:dayNumber -- "tickable." Not in tab05. A student may tick
 * their own plan (same reasoning POST /api/study-plan/generate already applies -- it's their
 * week, nothing here needs a parent's approval); a parent/admin can tick on the student's behalf,
 * checked against their own household via the plan's student_id.
 */
export const Route = createFileRoute('/api/study-plan/$id/days/$dayNumber')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'student', 'parent', 'admin')
        if (auth instanceof Response) return auth

        const dayNumber = Number(params.dayNumber)
        if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 7) {
          return Response.json(
            { error: 'dayNumber must be 1-7' },
            { status: 400 },
          )
        }

        const parsed = requestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        let studentId: string
        if (auth.role === 'student') {
          const student = await resolveEnabledStudent(db, auth.id)
          if (student instanceof Response) return student
          studentId = student.id
        } else {
          // The plan doesn't carry household_id directly -- resolve its owning student first,
          // scoped to this parent/admin's own household, the same join
          // GET /api/habit-drills/:id and GET /api/remediation/:id already use.
          const plan = await db
            .selectFrom('study_plans')
            .innerJoin('students', 'students.id', 'study_plans.student_id')
            .select('study_plans.student_id')
            .where('students.household_id', '=', auth.householdId)
            .where('study_plans.id', '=', params.id)
            .executeTakeFirst()
          if (!plan) return new Response(null, { status: 404 })
          studentId = plan.student_id
        }

        const updated = await setDayCompleted(
          db,
          studentId,
          params.id,
          dayNumber,
          parsed.data.completed,
        )
        if (!updated) return new Response(null, { status: 404 })
        return Response.json({ plan: updated })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/study-plan/$id/days/$dayNumber', ['PATCH'])
