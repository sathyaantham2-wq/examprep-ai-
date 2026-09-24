import { createFileRoute } from '@tanstack/react-router'
import { getSharedDb } from '../../../../../db/connection'
import { resolveAdaptiveStudent } from '../../../../../lib/adaptive/access'
import { getWrongQuestionsForConcept } from '../../../../../lib/adaptive/wrong-questions'
import { wrapRouteHandlers } from '../../../../../lib/error-log'

/**
 * GET /api/adaptive/concepts/:conceptId/wrong-questions -- the concept tracker's answer to "where
 * are the wrong questions" (2026-09-24, user feedback): her most recent questions on this concept,
 * across every evaluated attempt, where she did not get full marks, with the correct answer next
 * to her own -- the same post-confirmation allowance GET /api/attempts/:id/result already uses
 * (T09 amendment, 2026-09-22), just aggregated by concept instead of by one paper. Fetched
 * on-demand per concept (not folded into GET /api/adaptive/overview) so opening the overview never
 * pays for a query most concepts on it won't have their detail expanded for.
 */
export const Route = createFileRoute(
  '/api/adaptive/concepts/$conceptId/wrong-questions',
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getSharedDb()
        const resolved = await resolveAdaptiveStudent(request, db)
        if (resolved instanceof Response) return resolved
        const questions = await getWrongQuestionsForConcept(db, {
          studentId: resolved.student.id,
          conceptId: params.conceptId,
        })
        return Response.json({ questions })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/adaptive/concepts/$conceptId/wrong-questions', [
  'GET',
])
