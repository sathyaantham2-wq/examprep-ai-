import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { auditSyllabusFidelity } from '../../../lib/syllabus-fidelity'
import { wrapRouteHandlers } from '../../../lib/error-log'

// F106: not in tab05 -- a runtime-visible surface for the audit, not just a script, so an admin
// can see (and act on) violations without shelling into the DB. Admin-only, global reference data.
export const Route = createFileRoute('/api/admin/syllabus-fidelity')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const violations = await auditSyllabusFidelity(db)
        return Response.json({ violations, count: violations.length })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/admin/syllabus-fidelity', ['GET'])
