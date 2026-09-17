import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { questionsRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

// F117/F084: bulk-approving individually is impractical once a generation batch produces more
// than a couple of questions -- but only for Tier A (objective, <=2 marks, no diagram), which is
// *designed* to auto-approve with only a spot-check, per the examprep-question-generation skill.
// Tier B still requires POST /api/questions/:id/approve with a reviewer note one at a time --
// bulk-skipping that would defeat the entire reason Tier B exists.
export const Route = createFileRoute('/api/questions/approve-all')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const { items: drafts } = await questionsRepository.search(
          db,
          { status: 'draft' },
          1000,
          0,
        )
        const tierA = drafts.filter((q) => q.review_tier === 'A')

        const approved = await Promise.all(
          tierA.map((q) =>
            questionsRepository.update(db, q.id, {
              status: 'approved',
              reviewed_by: auth.id,
              reviewed_at: new Date(),
            }),
          ),
        )

        return Response.json({
          approved: approved.length,
          skipped_tier_b: drafts.length - tierA.length,
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/questions/approve-all', ['POST'])
