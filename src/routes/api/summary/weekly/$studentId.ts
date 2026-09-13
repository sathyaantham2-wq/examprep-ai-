import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { studentsRepository } from '../../../../db/repositories'
import { buildWeeklySummary } from '../../../../lib/weekly-summary'

const querySchema = z.object({
  week_start: z.string().date().optional(),
})

// F074 (tab05): GET /api/summary/weekly/:studentId, Parent, query week_start -> weekly summary
// payload. Defaults week_start to 7 days ago when omitted, so the screen has a sensible view with
// no query string at all.
export const Route = createFileRoute('/api/summary/weekly/$studentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          params.studentId,
        )
        if (!student) return new Response(null, { status: 404 })

        const weekStart = parsed.data.week_start
          ? new Date(parsed.data.week_start)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

        const summary = await buildWeeklySummary(db, student.id, weekStart)
        return Response.json(summary)
      },
    },
  },
})
