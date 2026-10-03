import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { getStudentActivityReport } from '../../../lib/student-activity'
import { wrapRouteHandlers } from '../../../lib/error-log'

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
})

/**
 * GET /api/admin/student-activity?days=30 -- how many students use the app and for how long
 * (admin only; 2026-10-03 request). Time is measured from the in-app activity pings, so it covers
 * only the period since they were introduced.
 */
export const Route = createFileRoute('/api/admin/student-activity')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const url = new URL(request.url)
        const parsed = querySchema.safeParse({
          days: url.searchParams.get('days') ?? undefined,
        })
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const report = await getStudentActivityReport(
          getSharedDb(),
          parsed.data.days,
        )
        return Response.json(report)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/admin/student-activity', ['GET'])
