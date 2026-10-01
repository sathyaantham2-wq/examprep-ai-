import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { deleteHouseholdData, studentSelfDeleteCheck } from '../../../lib/privacy'
import { wrapRouteHandlers } from '../../../lib/error-log'

const requestSchema = z.object({ confirm: z.literal('DELETE') })

/**
 * F098 for a student who signed up on her own (Google Play's account-deletion requirement).
 * GET says whether she may delete her own account, for the Settings screen. POST deletes it,
 * after the same check and a typed "DELETE". A student linked to a parent, or added by one, is
 * refused: that account and its history are the parent's to delete (POST /api/privacy/delete).
 */
export const Route = createFileRoute('/api/privacy/delete-self')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const check = await studentSelfDeleteCheck(getSharedDb(), auth.id)
        return Response.json(
          check.allowed ? { allowed: true } : { allowed: false, reason: check.reason },
        )
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const parsed = requestSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return Response.json(
            { error: 'confirm_required', message: 'Type DELETE to confirm.' },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const check = await studentSelfDeleteCheck(db, auth.id)
        if (!check.allowed) {
          return Response.json(
            {
              error: check.reason,
              message: 'A parent looks after this account. Ask them to delete it from their Settings.',
            },
            { status: 403 },
          )
        }

        await deleteHouseholdData(db, {
          householdId: check.householdId,
          householdName: check.householdName,
          requestedByUserId: auth.id,
        })
        return new Response(null, { status: 204 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/privacy/delete-self', ['GET', 'POST'])
