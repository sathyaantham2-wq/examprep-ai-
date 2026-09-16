import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { resolveEnabledStudent } from '../../../lib/access'
import { generateStudyPlan } from '../../../lib/study-plan'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

const requestSchema = z.object({
  student_id: z.string().uuid().optional(),
})

/**
 * F077: POST /api/study-plan/generate (tab06 /plan "regenerate"). Not in tab05. A student may
 * regenerate their own plan (it's their week, and nothing here needs a parent's approval the way
 * a mark override does); a parent/admin must name student_id, checked against their own
 * household. Regenerating always supersedes the current week's plan rather than erroring.
 */
export const Route = createFileRoute('/api/study-plan/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'student', 'parent', 'admin')
        if (auth instanceof Response) return auth

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

        const plan = await generateStudyPlan(db, studentId)
        return Response.json({ plan }, { status: 201 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/study-plan/generate', ['POST'])
