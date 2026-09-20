import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { incomingForStudent } from '../../../lib/guardian-links'
import { wrapRouteHandlers } from '../../../lib/error-log'

export const Route = createFileRoute('/api/guardian-invites/incoming')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        return Response.json(await incomingForStudent(getSharedDb(), auth.id))
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/guardian-invites/incoming', ['GET'])
