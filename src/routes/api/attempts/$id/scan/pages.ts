import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { MAX_PAGE_BYTES, SCAN_IMAGE_TYPES, addScanPage } from '../../../../../lib/scans'
import { readJson, withScanAccess } from '../../../../../lib/scan-routes'
import { wrapRouteHandlers } from '../../../../../lib/error-log'

const pageSchema = z.object({
  media_type: z.enum(SCAN_IMAGE_TYPES),
  image_base64: z
    .string()
    .min(100)
    .max(Math.ceil((MAX_PAGE_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/=]+$/),
})

// F050: POST one photographed page (compressed and turned upright in the browser first). It is
// stored encrypted (F097) and appended after the existing pages.
export const Route = createFileRoute('/api/attempts/$id/scan/pages')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withScanAccess(request, params.id, async (db, access) => {
          const parsed = pageSchema.safeParse(await readJson(request))
          if (!parsed.success) {
            return Response.json(
              { error: 'invalid_image', message: 'Send a JPEG, PNG or WebP photo under 3 MB.' },
              { status: 400 },
            )
          }
          const page = await addScanPage(db, access, {
            imageBase64: parsed.data.image_base64,
            mediaType: parsed.data.media_type,
          })
          return Response.json({ id: page.id, page_number: page.page_number }, { status: 201 })
        }),
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/scan/pages', ['POST'])
