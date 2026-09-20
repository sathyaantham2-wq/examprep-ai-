import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import { attemptsRepository } from '../../../../db/repositories'
import { loadReview } from '../../../../lib/answer-review'
import { wrapRouteHandlers } from '../../../../lib/error-log'

/**
 * GET /api/attempts/:id/review -- the student's own marks for a submitted paper: the multiple-
 * choice total and each written answer with its mark and feedback, plus how many marks she can
 * still question. Never includes the answer key or the marking scheme (CLAUDE.md, T09).
 */
export const Route = createFileRoute('/api/attempts/$id/review')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student
        const attempt = await attemptsRepository.findById(db, student.id, params.id)
        if (!attempt) return new Response(null, { status: 404 })
        return Response.json(await loadReview(db, attempt))
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/review', ['GET'])
