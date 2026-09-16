import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { resolveEnabledStudent } from '../../lib/access'
import { getSharedDb } from '../../db/connection'
import { studentsRepository, studyPlansRepository } from '../../db/repositories'
import { wrapRouteHandlers } from '../../lib/error-log'

const querySchema = z.object({
  student_id: z.string().uuid().optional(),
})

/**
 * GET /api/study-plan (tab06 /plan "Both": 7-day plan, exam countdown, daily tasks, regenerate --
 * this route covers F077's own piece, the plan itself). Not in tab05. Same auth shape as
 * GET /api/remediation/GET /api/habit-drills: a student sees only their own linked profile's
 * plan, a parent/admin must name student_id and it is checked against their own household.
 * Returns null rather than 404 when no plan has been generated yet -- "no plan exists" is a
 * normal state for a brand-new student, not an error.
 */
export const Route = createFileRoute('/api/study-plan')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student', 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
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
          if (!parsed.data.student_id) {
            return Response.json(
              { error: 'student_id is required' },
              { status: 400 },
            )
          }
          const student = await studentsRepository.findById(
            db,
            auth.householdId,
            parsed.data.student_id,
          )
          if (!student) return new Response(null, { status: 404 })
          studentId = student.id
        }

        // Most recent active plan, not just "any active" -- a plan from a week the parent
        // never got around to regenerating stays 'active' forever otherwise, and .find() alone
        // has no ordering guarantee across it and a genuinely current one.
        const plans = await studyPlansRepository.list(db, studentId)
        const active =
          plans
            .filter((p) => p.status === 'active')
            .sort((a, b) => b.week_start.getTime() - a.week_start.getTime())
            .at(0) ?? null
        return Response.json({ plan: active })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/study-plan', ['GET'])
