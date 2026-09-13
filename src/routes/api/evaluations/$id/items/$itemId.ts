import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../../lib/session'
import { getSharedDb } from '../../../../../db/connection'
import {
  evaluationsRepository,
  evaluationItemsRepository,
  patternHitsRepository,
  auditLogRepository,
} from '../../../../../db/repositories'

const ERROR_TYPES = [
  'Conceptual Gap',
  'Calculation Error',
  'Presentation Issue',
  'Formula/Definition Error',
  'Incomplete',
  'Not Attempted',
] as const

const overrideSchema = z
  .object({
    marks: z.number().nonnegative(),
    error_type: z.enum(ERROR_TYPES).nullable(),
    knowledge_known: z.boolean().nullable(),
    feedback: z.string().min(1),
    // F057: not in tab05's stated payload shape, but there's no other listed route for
    // attaching behaviour patterns to an answer, and this is the endpoint that already owns
    // per-item human review.
    pattern_ids: z.array(z.string().uuid()),
  })
  .partial()

// F047: any mark or error type is editable, the original AI value stays in ai_marks/
// ai_error_type (never overwritten here), and every override writes an audit_log row — the
// tracker (F061-F063) only ever reads marks_awarded/error_type, which is exactly what this
// endpoint changes.
export const Route = createFileRoute('/api/evaluations/$id/items/$itemId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = overrideSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
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

        const item = await evaluationItemsRepository.findById(db, params.itemId)
        if (!item || item.evaluation_id !== evaluation.id) {
          return new Response(null, { status: 404 })
        }

        const before = item
        const updated = await evaluationItemsRepository.update(db, item.id, {
          marks_awarded: parsed.data.marks,
          error_type: parsed.data.error_type,
          knowledge_known: parsed.data.knowledge_known,
          feedback: parsed.data.feedback,
          overridden_by: auth.id,
        })

        await auditLogRepository.insert(db, {
          household_id: auth.householdId,
          actor_user_id: auth.id,
          action: 'evaluation_item.override',
          entity: 'evaluation_items',
          entity_id: item.id,
          before: JSON.stringify(before),
          after: JSON.stringify(updated),
        })

        const patternHits =
          parsed.data.pattern_ids !== undefined
            ? await patternHitsRepository.replaceForItem(
                db,
                item.id,
                parsed.data.pattern_ids,
              )
            : await patternHitsRepository.listForItem(db, item.id)

        return Response.json({ ...updated, pattern_hits: patternHits })
      },
    },
  },
})
