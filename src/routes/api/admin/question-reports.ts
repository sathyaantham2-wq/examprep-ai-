import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import {
  listReportsForAdmin,
  setReportStatus,
} from '../../../lib/question-reports'
import { wrapRouteHandlers } from '../../../lib/error-log'

const statusSchema = z.enum(['open', 'resolved', 'dismissed', 'all'])
const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'resolved', 'dismissed']),
})

/**
 * F129: the admin's (own-household) queue of student "Report a problem" submissions, with the question, its key
 * and what the student actually answered side by side. PATCH marks one resolved/dismissed (or
 * reopens it). Fixing or retiring the question itself stays in /admin/questions.
 */
export const Route = createFileRoute('/api/admin/question-reports')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const parsed = statusSchema.safeParse(
          new URL(request.url).searchParams.get('status') ?? 'open',
        )
        if (!parsed.success) {
          return Response.json({ error: 'invalid_status' }, { status: 400 })
        }
        return Response.json(
          await listReportsForAdmin(
            getSharedDb(),
            auth.householdId,
            parsed.data,
          ),
        )
      },
      PATCH: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const parsed = patchSchema.safeParse(
          await request.json().catch(() => null),
        )
        if (!parsed.success) {
          return Response.json({ error: 'invalid_body' }, { status: 400 })
        }
        const ok = await setReportStatus(
          getSharedDb(),
          auth.householdId,
          parsed.data.id,
          parsed.data.status,
        )
        return ok
          ? Response.json({ ok: true })
          : new Response(null, { status: 404 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/admin/question-reports', ['GET', 'PATCH'])
