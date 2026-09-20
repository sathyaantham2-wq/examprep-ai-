import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../../../lib/session'
import { resolveEnabledStudent } from '../../../../../../lib/access'
import { getSharedDb } from '../../../../../../db/connection'
import { attemptsRepository } from '../../../../../../db/repositories'
import { removeAnswer } from '../../../../../../lib/answer-review'
import { wrapRouteHandlers } from '../../../../../../lib/error-log'

/**
 * POST /api/attempts/:id/items/:itemId/remove -- take a question out of the grade. Only allowed
 * after the AI has looked at the student's objection.
 */
export const Route = createFileRoute('/api/attempts/$id/items/$itemId/remove')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student
        const attempt = await attemptsRepository.findById(db, student.id, params.id)
        if (!attempt) return new Response(null, { status: 404 })
        const result = await removeAnswer(db, { attempt, itemId: params.itemId })
        if (!result.ok) {
          return Response.json({ error: result.error }, { status: result.error === 'item_not_found' ? 404 : 409 })
        }
        return Response.json(result)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/items/$itemId/remove', ['POST'])
