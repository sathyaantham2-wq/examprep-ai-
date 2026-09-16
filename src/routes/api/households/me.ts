import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { householdsRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

// Not in tab05 -- no route ever exposed the caller's own household record, needed by /settings
// (F098) to show the household name and to power the "type the name to confirm" delete gesture.
export const Route = createFileRoute('/api/households/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const household = await householdsRepository.findById(
          db,
          auth.householdId,
        )
        if (!household) return new Response(null, { status: 404 })
        return Response.json(household)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/households/me', ['GET'])
