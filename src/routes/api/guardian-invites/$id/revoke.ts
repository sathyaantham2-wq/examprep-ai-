import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { revokeByGuardian } from '../../../../lib/guardian-links'
import { wrapRouteHandlers } from '../../../../lib/error-log'

// A parent or teacher stops following a student, or cancels a request that is still pending.
export const Route = createFileRoute('/api/guardian-invites/$id/revoke')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'teacher', 'admin')
        if (auth instanceof Response) return auth
        const result = await revokeByGuardian(
          getSharedDb(),
          auth.householdId,
          params.id,
        )
        if (!result.ok) {
          return new Response(null, {
            status: result.error === 'not_found' ? 404 : 409,
          })
        }
        return Response.json(result.value)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/guardian-invites/$id/revoke', ['POST'])
