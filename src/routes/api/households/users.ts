import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { usersRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

// F083 (tab06 /admin/users): the household's own account list -- 'admin' here is a household
// member with an elevated role (promoteToAdmin only ever flips role, never household_id), not a
// cross-tenant superadmin, so this is already household-scoped for free via usersRepository.
export const Route = createFileRoute('/api/households/users')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const users = await usersRepository.list(db, auth.householdId)
        return Response.json(users)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/households/users', ['GET'])
