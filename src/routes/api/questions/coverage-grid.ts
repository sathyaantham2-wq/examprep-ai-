import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import {
  computeCoverageGrid,
  computeCoverageGridForSubject,
} from '../../../lib/coverage-grid'

const querySchema = z
  .object({
    concept_id: z.string().uuid().optional(),
    subject_id: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.concept_id) !== Boolean(v.subject_id), {
    message: 'Exactly one of concept_id or subject_id is required',
  })

// F115: not in tab05's listed routes -- the sheet has no admin question-bank grid endpoint at
// all -- added under /api/questions since this is a question-bank reporting view, the same
// resource GET /api/questions already covers. Global reference data (questions/concepts aren't
// household-owned), so this is Admin-only rather than household-scoped.
export const Route = createFileRoute('/api/questions/coverage-grid')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        if (parsed.data.concept_id) {
          const grid = await computeCoverageGrid(db, parsed.data.concept_id)
          return Response.json(grid)
        }
        const grids = await computeCoverageGridForSubject(
          db,
          parsed.data.subject_id!,
        )
        return Response.json(grids)
      },
    },
  },
})
