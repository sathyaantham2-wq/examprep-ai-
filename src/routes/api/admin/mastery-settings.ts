import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { auditLogRepository } from '../../../db/repositories'
import { DEFAULT_MASTERY_CONFIG } from '../../../lib/adaptive/config'
import { loadMasteryConfig, saveMasteryConfig } from '../../../lib/adaptive/service'
import { wrapRouteHandlers } from '../../../lib/error-log'

// Admin-only: every threshold, weight and window the adaptive engine uses. PUT takes a partial
// object that is merged over the current values and validated as a whole, so a bad edit is
// rejected instead of leaving the engine with a broken configuration.
export const Route = createFileRoute('/api/admin/mastery-settings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const config = await loadMasteryConfig(getSharedDb())
        return Response.json({ config, defaults: DEFAULT_MASTERY_CONFIG })
      },
      PUT: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const before = await loadMasteryConfig(db)
        const result = await saveMasteryConfig(db, auth.id, await request.json())
        if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
        await auditLogRepository.insert(db, {
          household_id: auth.householdId,
          actor_user_id: auth.id,
          action: 'mastery_settings.updated',
          entity: 'mastery_settings',
          entity_id: '00000000-0000-0000-0000-000000000000',
          before: JSON.stringify(before),
          after: JSON.stringify(result.config),
        })
        return Response.json({ config: result.config })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/admin/mastery-settings', ['GET', 'PUT'])
