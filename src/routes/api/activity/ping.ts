import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'
import { recordStudentPing } from '../../../lib/student-activity'
import { wrapRouteHandlers } from '../../../lib/error-log'

/**
 * POST /api/activity/ping -- "this student is here right now" (admin activity page, 2026-10-03).
 * Student role only, and always for herself: the student is found from the session, never from the
 * request, so nobody can credit time to someone else. No body is read. A student with no profile
 * (or any other role) gets a plain refusal; the client just stops.
 */
export const Route = createFileRoute('/api/activity/ping')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const student = await studentsRepository.findByUserId(db, auth.id)
        if (!student) return new Response(null, { status: 403 })

        await recordStudentPing(db, student.id)
        return new Response(null, { status: 204 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/activity/ping', ['POST'])
