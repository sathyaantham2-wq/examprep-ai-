import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../../lib/session'
import { createDb } from '../../../../../db/connection'
import { evaluationsRepository } from '../../../../../db/repositories'
import { buildDiagnosisReport } from '../../../../../lib/diagnosis'
import { buildReportHtml } from '../../../../../lib/pdf/report-template'
import { renderHtmlToPdf } from '../../../../../lib/pdf/render'

// F073: "downloadable PDF including error inventory and concept-wise performance." Not in
// tab05's listed routes -- only the JSON GET /api/evaluations/:id/report exists there -- added
// as a sibling path the same way GET /api/papers/:id/pdf sits alongside GET /api/papers/:id.
export const Route = createFileRoute('/api/evaluations/$id/report/pdf')({
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
          const html = buildReportHtml(report)
          const pdf = await renderHtmlToPdf(html)
          return new Response(new Uint8Array(pdf), {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': `inline; filename="${evaluation.id}-report.pdf"`,
            },
          })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
