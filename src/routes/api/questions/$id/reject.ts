import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { createDb } from '../../../../db/connection'
import { questionsRepository } from '../../../../db/repositories'

const rejectSchema = z.object({
  note: z.string().min(1),
})

/**
 * F084: "Draft/Approved/Rejected states with reviewer, timestamp and reason." The schema's
 * status column is the fixed three-value draft/approved/retired CHECK from CLAUDE.md invariant 4
 * ("nothing is deleted") -- there is no fourth "rejected" value, and adding one would break that
 * invariant's own lifecycle. 'Retired' is the correct target for a rejected question: it's
 * excluded from paper generation exactly like an approved-then-retired one, and the row is never
 * deleted. Unlike approve() (where a reason is only required for Tier B), rejecting always
 * requires a note -- the AC calls for "reason" unconditionally.
 */
export const Route = createFileRoute('/api/questions/$id/reject')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = rejectSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const existing = await questionsRepository.findById(db, params.id)
          if (!existing) return new Response(null, { status: 404 })

          const updated = await questionsRepository.update(db, params.id, {
            status: 'retired',
            review_note: parsed.data.note,
            reviewed_by: auth.id,
            reviewed_at: new Date(),
          })
          return Response.json(updated)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
