import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { papersRepository } from '../../../../db/repositories'
import { computeCoverageTable } from '../../../../lib/pdf/coverage'
import { wrapRouteHandlers } from '../../../../lib/error-log'

// tab05: GET /api/papers/:id/coverage, Parent -> concept coverage + Bloom breakdown. This is
// F037's "shown on screen" half -- no screen exists in this repo (none do), but the data it would
// call is real and lives at the same computeCoverageTable() the answer-key PDF appends (F037).
export const Route = createFileRoute('/api/papers/$id/coverage')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const paper = await papersRepository.findByIdForHousehold(
          db,
          auth.householdId,
          params.id,
        )
        if (!paper) return new Response(null, { status: 404 })

        const coverage = await computeCoverageTable(db, paper.id)
        return Response.json(coverage)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/papers/$id/coverage', ['GET'])
