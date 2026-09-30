import { createFileRoute } from '@tanstack/react-router'
import { getSharedDb } from '../../../../db/connection'
import { requireRole } from '../../../../lib/session'
import { startScanAttempt } from '../../../../lib/scans'
import { wrapRouteHandlers } from '../../../../lib/error-log'

// F050: "I have her written pages -- where do I photograph them?" Returns the attempt to attach
// photos to (her open one at this paper, or a new 'uploaded' one). Student, or a parent/admin of
// her household; any other caller gets 404.
export const Route = createFileRoute('/api/papers/$id/scan-attempt')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const user = await requireRole(request, 'student', 'parent', 'admin')
        if (user instanceof Response) return user
        const attempt = await startScanAttempt(getSharedDb(), user, params.id)
        if (attempt instanceof Response) return attempt
        if (!attempt) return new Response(null, { status: 404 })
        return Response.json({ attempt_id: attempt.id })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/papers/$id/scan-attempt', ['POST'])
