import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { conceptsRepository } from '../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../lib/error-log'

// F124: the first PATCH endpoint concepts has ever had -- deliberately scoped to just the
// curated-video pair rather than a general concept editor (idea/rule/example/target_question_count
// etc. still have no PATCH route anywhere, per F015/F022's existing notes; that's separate,
// unrequested scope). null clears a field -- a curated link found to be wrong or dead can be
// unset without a new migration or a direct DB edit.
const patchSchema = z
  .object({
    video_url: z.string().url().nullable(),
    video_title: z.string().min(1).nullable(),
  })
  .partial()

export const Route = createFileRoute('/api/syllabus/concepts/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = patchSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const existing = await conceptsRepository.findById(db, params.id)
        if (!existing) return new Response(null, { status: 404 })

        const updated = await conceptsRepository.update(
          db,
          params.id,
          parsed.data,
        )
        return Response.json(updated)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/syllabus/concepts/$id', ['PATCH'])
