import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { deleteHouseholdData } from '../../../lib/privacy'
import { householdsRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

const requestSchema = z.object({
  confirm_household_name: z.string().min(1),
})

/**
 * F098's "hard delete" half -- not in tab05 (which only lists export), but the AC explicitly
 * requires it. Parent-only, and requires re-typing the household's own name as the confirmation
 * gesture (not just a boolean) since this is genuinely irreversible and destroys every table that
 * cascades from households.id -- effectively the whole household's data.
 */
export const Route = createFileRoute('/api/privacy/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = requestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const household = await householdsRepository.findById(
          db,
          auth.householdId,
        )
        if (!household) return new Response(null, { status: 404 })

        if (parsed.data.confirm_household_name !== household.name) {
          return Response.json(
            {
              error:
                "confirm_household_name did not match this household's name",
            },
            { status: 400 },
          )
        }

        await deleteHouseholdData(db, {
          householdId: household.id,
          householdName: household.name,
          requestedByUserId: auth.id,
        })

        return new Response(null, { status: 204 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/privacy/delete', ['POST'])
