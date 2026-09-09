import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { createDb } from '../../../../db/connection'
import {
  evaluationsRepository,
  habitObservationsRepository,
} from '../../../../db/repositories'

const HABIT_RATINGS = ['present', 'partial', 'absent'] as const

const habitsSchema = z.object({
  observations: z.array(
    z.object({
      habit_id: z.string().uuid(),
      rating: z.enum(HABIT_RATINGS),
      evidence_note: z.string().min(1).optional(),
    }),
  ),
})

// F058: "each habit rated present/partial/absent per paper." Not in tab05's listed routes -- the
// sheet only names GET /api/evaluations/:id/report as the place habits show up for reading, not
// writing -- added as a sibling to the evaluation-item override endpoint (F047), which is the
// same "human reviews this evaluation" surface this belongs to.
export const Route = createFileRoute('/api/evaluations/$id/habits')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = habitsSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

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
              {
                error:
                  'This evaluation is already confirmed and can no longer be edited',
              },
              { status: 409 },
            )
          }

          const updated =
            await habitObservationsRepository.replaceForEvaluation(
              db,
              evaluation.id,
              parsed.data.observations,
            )
          return Response.json(updated)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
