import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../lib/session'
import { getSharedDb } from '../../db/connection'
import { auditLogRepository } from '../../db/repositories'

// F099: "visible to household owner." Not in tab05's listed routes -- no read endpoint for
// audit_log exists there at all -- added as the smallest reasonable path (a new top-level
// resource, since audit entries span several different entity types, not just one).
export const Route = createFileRoute('/api/audit-log')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const entries = await auditLogRepository.listRecent(
          db,
          auth.householdId,
          100,
        )
        return Response.json(entries)
      },
    },
  },
})
