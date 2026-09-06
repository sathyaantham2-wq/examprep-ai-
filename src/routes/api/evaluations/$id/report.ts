import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { buildDiagnosisReport } from '../../../../lib/diagnosis'
import { createDb } from '../../../../db/connection'
import { evaluationsRepository } from '../../../../db/repositories'

export const Route = createFileRoute('/api/evaluations/$id/report')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
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
          if (!evaluation.confirmed_at) {
            return Response.json(
              {
                error:
                  'Report is only available once the evaluation is confirmed',
              },
              { status: 409 },
            )
          }

          const report = await buildDiagnosisReport(db, evaluation.id)
          return Response.json(report)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
