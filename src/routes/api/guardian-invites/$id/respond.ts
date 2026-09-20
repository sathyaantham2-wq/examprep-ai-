import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { respondToInvite } from '../../../../lib/guardian-links'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const schema = z.object({ approve: z.boolean() })

export const Route = createFileRoute('/api/guardian-invites/$id/respond')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const parsed = schema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }
        const result = await respondToInvite(
          getSharedDb(),
          auth.id,
          params.id,
          parsed.data.approve,
        )
        if (!result.ok) {
          if (result.error === 'not_found') {
            return new Response(null, { status: 404 })
          }
          const message =
            result.error === 'student_already_linked'
              ? 'You are already sharing your progress with someone. Stop sharing first, then approve this request.'
              : 'This request has already been answered.'
          return Response.json({ error: message }, { status: 409 })
        }
        return Response.json(result.value)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/guardian-invites/$id/respond', ['POST'])
