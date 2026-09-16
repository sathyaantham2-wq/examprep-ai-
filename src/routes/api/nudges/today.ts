import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'
import { generateOrGetTodayNudge } from '../../../lib/daily-nudge'
import { wrapRouteHandlers } from '../../../lib/error-log'

const querySchema = z.object({
  student_id: z.string().uuid(),
})

/**
 * F082 (tab03): "A single concrete action derived from the latest diagnosis, delivered once
 * daily, marked done or skipped." Parent/admin-only, matching the AC's own user story ("As a
 * parent I want one instruction a day") -- unlike F077's study plan, there is no student-facing
 * screen for this in the plan, so no student-role path is built here.
 */
export const Route = createFileRoute('/api/nudges/today')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }

        const db = getSharedDb()
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          parsed.data.student_id,
        )
        if (!student) return new Response(null, { status: 404 })

        const nudge = await generateOrGetTodayNudge(db, student.id)
        return Response.json({ nudge })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/nudges/today', ['GET'])
