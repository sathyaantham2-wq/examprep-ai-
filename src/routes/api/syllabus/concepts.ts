import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireUser } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { conceptsRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

const querySchema = z
  .object({
    chapter_id: z.string().uuid().optional(),
    subject_id: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.chapter_id) !== Boolean(v.subject_id), {
    message: 'Exactly one of chapter_id or subject_id is required',
  })

// F084/F086: not in tab05 — no route ever listed concepts by chapter or subject, which the
// admin question bank's concept picker and the AI-generate form both need.
export const Route = createFileRoute('/api/syllabus/concepts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request)
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
        const concepts = parsed.data.chapter_id
          ? await conceptsRepository.listByChapter(db, parsed.data.chapter_id)
          : await conceptsRepository.listBySubject(db, parsed.data.subject_id!)
        return Response.json(concepts)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/syllabus/concepts', ['GET'])
