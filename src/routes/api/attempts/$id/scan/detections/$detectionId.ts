import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { updateDetection } from '../../../../../../lib/scans'
import { readJson, withScanAccess } from '../../../../../../lib/scan-routes'
import { wrapRouteHandlers } from '../../../../../../lib/error-log'

const patchSchema = z.object({
  action: z.enum(['confirm', 'discard', 'restore']),
  paper_question_id: z.string().uuid().nullable().optional(),
  response_text: z.string().max(4000).nullable().optional(),
  selected_option: z.string().max(20).nullable().optional(),
})

// F052/F053: assign a reading to a question, correct it, confirm it, or discard it.
export const Route = createFileRoute('/api/attempts/$id/scan/detections/$detectionId')({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        withScanAccess(request, params.id, async (db, access) => {
          const parsed = patchSchema.safeParse(await readJson(request))
          if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })
          await updateDetection(db, access, params.detectionId, parsed.data)
          return new Response(null, { status: 204 })
        }),
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/scan/detections/$detectionId', ['PATCH'])
