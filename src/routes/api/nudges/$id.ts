import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'
import { markNudgeStatus } from '../../../lib/daily-nudge'
import { wrapRouteHandlers } from '../../../lib/error-log'

const patchSchema = z.object({
  student_id: z.string().uuid(),
  status: z.enum(['done', 'skipped']),
})

// F082: "marked done or skipped." Parent/admin-only, same auth shape as GET /api/nudges/today.
export const Route = createFileRoute('/api/nudges/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = patchSchema.safeParse(await request.json())
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

        const updated = await markNudgeStatus(db, student.id, params.id, parsed.data.status)
        if (!updated) return new Response(null, { status: 404 })

        return Response.json({ nudge: updated })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/nudges/$id', ['PATCH'])
