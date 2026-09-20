import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import { attemptsRepository } from '../../../../db/repositories'
import { finalizeReview } from '../../../../lib/answer-review'
import { wrapRouteHandlers } from '../../../../lib/error-log'

/** POST /api/attempts/:id/finalize -- the student accepts her marks; they become final. */
export const Route = createFileRoute('/api/attempts/$id/finalize')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student
        const attempt = await attemptsRepository.findById(db, student.id, params.id)
        if (!attempt) return new Response(null, { status: 404 })
        const result = await finalizeReview(db, { student, attempt })
        if (!result.ok) return Response.json({ error: result.error }, { status: 409 })
        return Response.json({ evaluation_id: result.evaluation_id })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/finalize', ['POST'])
