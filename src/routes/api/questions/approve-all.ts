import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { questionsRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

const bodySchema = z.object({
  // Tier A (objective, <=2 marks, no diagram) is designed to auto-approve with only a spot-check
  // (examprep-question-generation skill), so it never needed a note. Tier B is "requires full
  // human review" -- the admin explicitly opts into bulk-approving it too by setting this, and
  // the note they give (or the default below) is still recorded on every row, same as approving
  // one at a time, so there's still an audit trail of who signed off and when.
  include_tier_b: z.boolean().optional(),
  note: z.string().min(1).optional(),
})

export const Route = createFileRoute('/api/questions/approve-all')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = bodySchema.safeParse(
          await request.json().catch(() => ({})),
        )
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const { items: drafts } = await questionsRepository.search(
          db,
          { status: 'draft' },
          1000,
          0,
        )
        const toApprove = parsed.data.include_tier_b
          ? drafts
          : drafts.filter((q) => q.review_tier === 'A')
        const note =
          parsed.data.note ??
          'Bulk-approved by admin (individual per-question review skipped by request)'

        const approved = await Promise.all(
          toApprove.map((q) =>
            questionsRepository.update(db, q.id, {
              status: 'approved',
              // Kysely's set() forwards every key verbatim including an explicit `undefined`, so
              // review_note is only added to the payload for Tier B rows that actually need it.
              ...(q.review_tier === 'B' ? { review_note: note } : {}),
              reviewed_by: auth.id,
              reviewed_at: new Date(),
            }),
          ),
        )

        return Response.json({
          approved: approved.length,
          skipped_tier_b: drafts.length - toApprove.length,
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/questions/approve-all', ['POST'])
