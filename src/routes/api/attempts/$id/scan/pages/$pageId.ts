import { createFileRoute } from '@tanstack/react-router'
import { removeScanPage } from '../../../../../../lib/scans'
import { withScanAccess } from '../../../../../../lib/scan-routes'
import { wrapRouteHandlers } from '../../../../../../lib/error-log'

// F050: remove a page (a blurred or wrong photo) while the paper is still open.
export const Route = createFileRoute('/api/attempts/$id/scan/pages/$pageId')({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        withScanAccess(request, params.id, async (db, access) => {
          await removeScanPage(db, access, params.pageId)
          return new Response(null, { status: 204 })
        }),
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/scan/pages/$pageId', ['DELETE'])
