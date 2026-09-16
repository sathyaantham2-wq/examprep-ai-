import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getCurrentUser } from '../../lib/session'
import { captureError, wrapRouteHandlers } from '../../lib/error-log'

const bodySchema = z.object({
  request_id: z.string().uuid(),
  route: z.string().min(1),
  message: z.string().min(1),
  stack: z.string().optional(),
})

/**
 * F004: "capturing client ... errors." Deliberately no requireRole -- a client error can happen
 * on a public page or before a session resolves, and reporting it is exactly the case this route
 * exists for; it's never a source of private data (the browser only ever sends its own error
 * message/stack/route, nothing server-side). See src/lib/client-error-reporting.ts for the
 * browser-side listeners that call this.
 */
export const Route = createFileRoute('/api/errors')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }

        const user = await getCurrentUser(request).catch(() => null)
        await captureError({
          requestId: parsed.data.request_id,
          source: 'client',
          route: parsed.data.route,
          message: parsed.data.message,
          stack: parsed.data.stack,
          userId: user?.id,
          householdId: user?.householdId,
        })

        return new Response(null, { status: 204 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/errors', ['POST'])
