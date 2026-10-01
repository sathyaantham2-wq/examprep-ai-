import { createFileRoute } from '@tanstack/react-router'
import { extractScanPage } from '../../../../../../../lib/scans'
import { withScanAccess } from '../../../../../../../lib/scan-routes'
import { wrapRouteHandlers } from '../../../../../../../lib/error-log'

// F051 + F052: read one page with the vision model and map its answers to questions. One page
// per request, so a long paper never runs into a function timeout. The screen reads them in turn.
export const Route = createFileRoute('/api/attempts/$id/scan/pages/$pageId/extract')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withScanAccess(request, params.id, async (db, access) =>
          Response.json(await extractScanPage(db, access, params.pageId)),
        ),
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/scan/pages/$pageId/extract', ['POST'])
