import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import {
  generationBatchItemsRepository,
  generationBatchesRepository,
} from '../../../../db/repositories'

/** F116: GET /api/questions/generate-batch/:id -- progress view (status, cost spent, per-cell
 * outcome) so an admin can see what a batch actually did, not in tab05 (predates this feature). */
export const Route = createFileRoute('/api/questions/generate-batch/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const batch = await generationBatchesRepository.findById(db, params.id)
        if (!batch) return new Response(null, { status: 404 })

        const items = await generationBatchItemsRepository.listByBatch(
          db,
          params.id,
        )
        return Response.json({ batch, items })
      },
    },
  },
})
