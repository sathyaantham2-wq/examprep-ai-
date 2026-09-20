import { createFileRoute } from '@tanstack/react-router'
import { getSharedDb } from '../../../db/connection'
import { resolveAdaptiveStudent } from '../../../lib/adaptive/access'
import { buildAdaptiveOverview } from '../../../lib/adaptive/overview'
import { wrapRouteHandlers } from '../../../lib/error-log'

// Concept-level mastery for the signed-in student (or, for a parent/teacher/admin, the student
// named in ?student_id= within their own household).
export const Route = createFileRoute('/api/adaptive/overview')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const db = getSharedDb()
        const resolved = await resolveAdaptiveStudent(request, db)
        if (resolved instanceof Response) return resolved
        const overview = await buildAdaptiveOverview(db, resolved.student.id)
        if (!overview) return new Response(null, { status: 404 })
        return Response.json(overview)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/adaptive/overview', ['GET'])
