import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { getProductFunnelReport } from '../../../lib/product-events'

const DEFAULT_WINDOW_DAYS = 30

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
})

/**
 * F093: GET /api/admin/product-funnel?from&to -- "funnel view" behind an admin dashboard.
 * `from`/`to` default to a trailing 30-day window, same documented-default reasoning as
 * /api/admin/ai-usage (F091); `to` stays unbounded unless explicitly given, for the same
 * clock-skew reason that route documents -- pinning it to the app server's local `new Date()`
 * can silently exclude a row the DB server just wrote moments earlier.
 */
export const Route = createFileRoute('/api/admin/product-funnel')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const url = new URL(request.url)
        const parsed = querySchema.safeParse({
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
        })
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }

        const to = parsed.data.to ? new Date(`${parsed.data.to}T23:59:59.999Z`) : null
        const from = parsed.data.from
          ? new Date(`${parsed.data.from}T00:00:00.000Z`)
          : new Date((to ?? new Date()).getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        if (Number.isNaN(from.getTime()) || (to !== null && Number.isNaN(to.getTime()))) {
          return Response.json({ error: 'from/to must be YYYY-MM-DD dates' }, { status: 400 })
        }

        const db = createDb()
        try {
          const report = await getProductFunnelReport(db, { from, to })
          return Response.json(report)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
