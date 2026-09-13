import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { questionsRepository } from '../../../../db/repositories'

const approveSchema = z.object({
  note: z.string().min(1).optional(),
})

export const Route = createFileRoute('/api/questions/$id/approve')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = approveSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const existing = await questionsRepository.findById(db, params.id)
        if (!existing) return new Response(null, { status: 404 })

        // Tier B is "requires full human review" (F117) — a reviewer note is the evidence
        // that review happened, so it's required here even though it's optional for Tier A.
        if (existing.review_tier === 'B' && !parsed.data.note) {
          return Response.json(
            {
              error: 'A reviewer note is required to approve a Tier B question',
            },
            { status: 400 },
          )
        }

        const updated = await questionsRepository.update(db, params.id, {
          status: 'approved',
          review_note: parsed.data.note,
          reviewed_by: auth.id,
          reviewed_at: new Date(),
        })
        return Response.json(updated)
      },
    },
  },
})
