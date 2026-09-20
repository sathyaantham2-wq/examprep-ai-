import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../../../lib/session'
import { resolveEnabledStudent } from '../../../../../../lib/access'
import { getSharedDb } from '../../../../../../db/connection'
import { attemptsRepository } from '../../../../../../db/repositories'
import { disputeAnswer } from '../../../../../../lib/answer-review'
import type { ReviewActionError } from '../../../../../../lib/answer-review'
import { wrapRouteHandlers } from '../../../../../../lib/error-log'

const bodySchema = z.object({ comment: z.string().max(2000) })

const STATUS: Record<ReviewActionError, number> = {
  comment_length: 400,
  not_reviewable: 409,
  item_not_found: 404,
  already_disputed: 409,
  already_removed: 409,
  limit_reached: 409,
  not_disputed: 409,
  ai_unavailable: 503,
  ai_limit: 429,
  ai_failed: 502,
}

/**
 * POST /api/attempts/:id/items/:itemId/dispute -- "I disagree with this mark", with her reason.
 * The AI looks again once and answers; see answer-review.ts for the rules.
 */
export const Route = createFileRoute('/api/attempts/$id/items/$itemId/dispute')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const parsed = bodySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'comment_length' }, { status: 400 })
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student
        const attempt = await attemptsRepository.findById(db, student.id, params.id)
        if (!attempt) return new Response(null, { status: 404 })
        const result = await disputeAnswer(db, {
          student,
          attempt,
          itemId: params.itemId,
          comment: parsed.data.comment,
        })
        if (!result.ok) return Response.json({ error: result.error }, { status: STATUS[result.error] })
        return Response.json(result)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/items/$itemId/dispute', ['POST'])
