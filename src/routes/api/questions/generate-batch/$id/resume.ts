import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../../lib/session'
import { getSharedDb } from '../../../../../db/connection'
import { runBatch } from '../../../../../lib/generation-batches'
import {
  generationBatchItemsRepository,
  generationBatchesRepository,
} from '../../../../../db/repositories'

/**
 * F116: POST /api/questions/generate-batch/:id/resume -- continues a 'paused' batch's remaining
 * pending cells. Idempotent: a cell already 'done' is never reprocessed (see generation-batches.ts
 * runBatch), so calling this repeatedly on the same batch cannot generate duplicate questions.
 */
export const Route = createFileRoute(
  '/api/questions/generate-batch/$id/resume',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const existing = await generationBatchesRepository.findById(
          db,
          params.id,
        )
        if (!existing) return new Response(null, { status: 404 })

        const summary = await runBatch(db, params.id)
        const items = await generationBatchItemsRepository.listByBatch(
          db,
          params.id,
        )
        return Response.json({ batch: summary, items })
      },
    },
  },
})
