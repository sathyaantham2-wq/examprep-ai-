import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { usersRepository, auditLogRepository } from '../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const updateUserSchema = z.object({
  is_active: z.boolean(),
})

export const Route = createFileRoute('/api/households/users/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = updateUserSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        // findById is scoped by household -- a user id from another household resolves to
        // undefined here, same protection as every other scoped resource (T02).
        const existing = await usersRepository.findById(
          db,
          auth.householdId,
          params.id,
        )
        if (!existing) return new Response(null, { status: 404 })

        // The only lockout guard this route needs: only an active admin can reach it at all
        // (requireRole -> getCurrentUser's is_active check), and an admin can never deactivate
        // themselves, so the caller's own account always stays active. That alone guarantees the
        // household can never be left with zero active parent/admin accounts.
        if (!parsed.data.is_active && existing.id === auth.id) {
          return Response.json(
            { error: 'You cannot deactivate your own account.' },
            { status: 400 },
          )
        }

        const updated = await usersRepository.update(
          db,
          auth.householdId,
          params.id,
          { is_active: parsed.data.is_active },
        )

        // F083 AC: "every write audited."
        await auditLogRepository.insert(db, {
          household_id: auth.householdId,
          actor_user_id: auth.id,
          action: parsed.data.is_active ? 'user.reactivated' : 'user.deactivated',
          entity: 'users',
          entity_id: existing.id,
          before: JSON.stringify(existing),
          after: JSON.stringify(updated),
        })

        return Response.json(updated)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/households/users/$id', ['PATCH'])
