import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { getAiUsageReport } from '../../../lib/ai-usage'

const DEFAULT_WINDOW_DAYS = 30

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  group_by: z.enum(['day', 'feature', 'student']).default('day'),
})

/**
 * F091 / tab05: GET /api/admin/ai-usage?from&to&group_by -- "token and cost aggregates" behind
 * the tab06 /admin/usage screen. `from`/`to` default to a trailing 30-day window (documented
 * default -- tab05 names the params but not a default range) rather than requiring the admin to
 * always pass one.
 */
export const Route = createFileRoute('/api/admin/ai-usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const url = new URL(request.url)
        const parsed = querySchema.safeParse({
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
          group_by: url.searchParams.get('group_by') ?? undefined,
        })
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }

        // `to` stays null ("no upper bound") when the caller didn't ask for one -- pinning it to
        // `new Date()` and filtering `created_at <= to` races the app server's clock against the
        // DB server's own `now()` used for created_at: whichever clock runs a few hundred ms
        // ahead can make a just-written row's created_at land after this request's `to`, silently
        // dropping it from "today"'s totals. Only an explicit `to=YYYY-MM-DD` needs a real bound.
        const to = parsed.data.to ? new Date(`${parsed.data.to}T23:59:59.999Z`) : null
        const from = parsed.data.from
          ? new Date(`${parsed.data.from}T00:00:00.000Z`)
          : new Date((to ?? new Date()).getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        if (Number.isNaN(from.getTime()) || (to !== null && Number.isNaN(to.getTime()))) {
          return Response.json({ error: 'from/to must be YYYY-MM-DD dates' }, { status: 400 })
        }

        const db = createDb()
        try {
          const report = await getAiUsageReport(db, {
            from,
            to,
            groupBy: parsed.data.group_by,
          })
          return Response.json(report)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
