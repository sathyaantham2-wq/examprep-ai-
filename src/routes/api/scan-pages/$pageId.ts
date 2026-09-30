import { createFileRoute } from '@tanstack/react-router'
import { getSharedDb } from '../../../db/connection'
import { requireRole } from '../../../lib/session'
import { verifyScanPageSignature } from '../../../lib/scan-crypto'
import { loadScanImage } from '../../../lib/scans'
import { wrapRouteHandlers } from '../../../lib/error-log'

// F097: the only way a page image leaves the server. It needs a valid, unexpired signature
// (issued by GET /api/attempts/:id/scan) AND a signed-in viewer with access to that student.
// Either one missing is a plain 404, and the response is never cached anywhere.
export const Route = createFileRoute('/api/scan-pages/$pageId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url)
        const signed = verifyScanPageSignature(
          params.pageId,
          url.searchParams.get('exp'),
          url.searchParams.get('sig'),
        )
        if (!signed) return new Response(null, { status: 404 })
        const user = await requireRole(request, 'student', 'parent', 'admin')
        if (user instanceof Response) return new Response(null, { status: 404 })
        const image = await loadScanImage(getSharedDb(), user, params.pageId)
        if (!image) return new Response(null, { status: 404 })
        return new Response(new Uint8Array(image.bytes), {
          headers: {
            'content-type': image.mime,
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
          },
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/scan-pages/$pageId', ['GET'])
