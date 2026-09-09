import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { confirmEvaluation } from '../../../../lib/evaluation'
import { createDb } from '../../../../db/connection'
import {
  evaluationsRepository,
  auditLogRepository,
} from '../../../../db/repositories'

export const Route = createFileRoute('/api/evaluations/$id/confirm')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          const evaluation = await evaluationsRepository.findByIdForHousehold(
            db,
            auth.householdId,
            params.id,
          )
          if (!evaluation) return new Response(null, { status: 404 })
          if (evaluation.confirmed_at) {
            return Response.json(
              { error: 'Already confirmed' },
              { status: 409 },
            )
          }

          const updated = await confirmEvaluation(db, evaluation.id)

          // F099: confirming an evaluation finalises marks that can no longer be overridden --
          // exactly the "score" event the audit trail exists to trace.
          await auditLogRepository.insert(db, {
            household_id: auth.householdId,
            actor_user_id: auth.id,
            action: 'evaluation.confirmed',
            entity: 'evaluations',
            entity_id: evaluation.id,
            before: JSON.stringify(evaluation),
            after: JSON.stringify(updated),
          })

          return Response.json(updated)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
