import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getScanState, reorderScanPages } from '../../../../lib/scans'
import { readJson, withScanAccess } from '../../../../lib/scan-routes'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const reorderSchema = z.object({ page_ids: z.array(z.string().uuid()).min(1).max(50) })

// F050-F053: GET the whole scan (pages as signed links, readings, what still needs checking);
// PATCH to reorder pages. Student or a parent/admin of her household.
export const Route = createFileRoute('/api/attempts/$id/scan')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withScanAccess(request, params.id, async (db, access) =>
          Response.json(await getScanState(db, access)),
        ),
      PATCH: ({ request, params }) =>
        withScanAccess(request, params.id, async (db, access) => {
          const parsed = reorderSchema.safeParse(await readJson(request))
          if (!parsed.success) return Response.json({ error: 'bad_order' }, { status: 400 })
          await reorderScanPages(db, access, parsed.data.page_ids)
          return Response.json(await getScanState(db, access))
        }),
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/scan', ['GET', 'PATCH'])
