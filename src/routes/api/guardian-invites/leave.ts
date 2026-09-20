import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { leaveGuardian } from '../../../lib/guardian-links'
import { wrapRouteHandlers } from '../../../lib/error-log'

// The student stops sharing her progress. She goes back to her own household; nothing is deleted.
export const Route = createFileRoute('/api/guardian-invites/leave')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const result = await leaveGuardian(getSharedDb(), auth.id)
        if (!result.ok) {
          return Response.json(
            { error: 'You are not sharing with anyone.' },
            { status: 409 },
          )
        }
        return Response.json(result.value)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/guardian-invites/leave', ['POST'])
