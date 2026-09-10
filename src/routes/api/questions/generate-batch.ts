import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { planBatch, runBatch } from '../../../lib/generation-batches'
import { generationBatchItemsRepository } from '../../../db/repositories'

const requestSchema = z.object({
  subject_id: z.string().uuid(),
  cost_cap_inr: z.number().positive(),
})

/**
 * F116: POST /api/questions/generate-batch (not in tab05 -- that sheet predates this feature).
 * Plans every shortfall Bloom x difficulty cell for the subject (F115's grid), then immediately
 * runs the first chunk of cells synchronously (there's no background job runner in this app) up
 * to a per-request safety limit and the batch's own cost cap. If cells remain pending afterward,
 * the batch is left 'paused' and POST .../:id/resume continues it -- "resumable" without needing
 * real background infra.
 */
export const Route = createFileRoute('/api/questions/generate-batch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = requestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const plan = await planBatch(db, {
            subjectId: parsed.data.subject_id,
            costCapInr: parsed.data.cost_cap_inr,
            createdBy: auth.id,
          })

          if (!plan.ok) {
            if (plan.reason === 'ai_not_configured') {
              return Response.json({
                batch: null,
                message:
                  'No AI provider is configured. Admin writes questions manually; the review queue stays Draft-only.',
              })
            }
            return Response.json({
              batch: null,
              message: 'Every Bloom x difficulty cell in this subject already meets its target.',
            })
          }

          const summary = await runBatch(db, plan.batchId)
          const items = await generationBatchItemsRepository.listByBatch(
            db,
            plan.batchId,
          )
          return Response.json({ batch: summary, items }, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
