import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { exportHouseholdData } from '../../../lib/privacy'
import { auditLogRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

/**
 * F098 (tab05): POST /api/privacy/export, Parent. tab05 describes an async job + email delivery
 * (M16 notifications, Not Started) -- there's no job queue or email provider in this app, so this
 * returns the full export synchronously in the response instead of faking a job id. A parent's
 * own household data isn't large enough at launch scope for that to be a real problem.
 */
export const Route = createFileRoute('/api/privacy/export')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const data = await exportHouseholdData(db, auth.householdId)

        await auditLogRepository.insert(db, {
          household_id: auth.householdId,
          actor_user_id: auth.id,
          action: 'privacy.exported',
          entity: 'households',
          entity_id: auth.householdId,
        })

        return new Response(JSON.stringify(data, null, 2), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-disposition': `attachment; filename="examprep-export-${auth.householdId}.json"`,
          },
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/privacy/export', ['POST'])
