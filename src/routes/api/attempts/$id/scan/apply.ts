import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { applyScan } from '../../../../../lib/scans'
import { readJson, withScanAccess } from '../../../../../lib/scan-routes'
import { wrapRouteHandlers } from '../../../../../lib/error-log'

const applySchema = z.object({ confirm_blanks: z.boolean().optional() })

// F053: once every reading is settled, write them in as the attempt's answers and send the paper
// for marking, the same as a typed attempt's Submit. Refuses (409) while anything needs checking.
export const Route = createFileRoute('/api/attempts/$id/scan/apply')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withScanAccess(request, params.id, async (db, access) => {
          const parsed = applySchema.safeParse((await readJson(request)) ?? {})
          if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })
          return Response.json(
            await applyScan(db, access, { confirmBlanks: parsed.data.confirm_blanks ?? false }),
          )
        }),
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/scan/apply', ['POST'])
