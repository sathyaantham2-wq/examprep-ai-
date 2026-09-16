import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { resolveEnabledStudent } from '../../lib/access'
import { buildExamCountdownReport } from '../../lib/exam-countdown'
import { getSharedDb } from '../../db/connection'
import { studentsRepository } from '../../db/repositories'
import { wrapRouteHandlers } from '../../lib/error-log'

const querySchema = z.object({
  student_id: z.string().uuid().optional(),
})

/**
 * F078 (tab06 /plan "Both": exam countdown). Not in tab05. Same auth shape as
 * GET /api/study-plan/GET /api/remediation: a student sees only their own linked profile's
 * countdown, a parent/admin must name student_id and it is checked against their own household.
 */
export const Route = createFileRoute('/api/exam-countdown')({
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

        const report = await buildExamCountdownReport(db, studentId)
        return Response.json(report)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/exam-countdown', ['GET'])
