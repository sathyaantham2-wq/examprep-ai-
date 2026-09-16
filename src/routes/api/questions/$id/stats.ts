import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { questionsRepository } from '../../../../db/repositories'
import { computeQuestionStats } from '../../../../lib/question-stats'
import { wrapRouteHandlers } from '../../../../lib/error-log'

// F118: "live stats (attempts, success rate by mastery level, mean time); anomalous items are
// auto-flagged for review." Not in tab05's listed routes -- no stats endpoint exists there --
// added as a sibling path under the existing /api/questions/:id resource.
export const Route = createFileRoute('/api/questions/$id/stats')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const question = await questionsRepository.findById(db, params.id)
        if (!question) return new Response(null, { status: 404 })

        const stats = await computeQuestionStats(db, question.id)
        return Response.json(stats)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/questions/$id/stats', ['GET'])
