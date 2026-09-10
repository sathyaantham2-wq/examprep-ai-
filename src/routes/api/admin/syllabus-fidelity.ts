import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { auditSyllabusFidelity } from '../../../lib/syllabus-fidelity'

// F106: not in tab05 -- a runtime-visible surface for the audit, not just a script, so an admin
// can see (and act on) violations without shelling into the DB. Admin-only, global reference data.
export const Route = createFileRoute('/api/admin/syllabus-fidelity')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          const violations = await auditSyllabusFidelity(db)
          return Response.json({ violations, count: violations.length })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
