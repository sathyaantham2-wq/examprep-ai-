import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { chaptersRepository } from '../../../db/repositories'

export const Route = createFileRoute('/api/syllabus/chapters')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request)
        if (auth instanceof Response) return auth

        const subjectId = new URL(request.url).searchParams.get('subject_id')
        if (!subjectId) {
          return Response.json(
            { error: 'subject_id query param is required' },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const chapters = await chaptersRepository.listBySubjectWithScopeCounts(
          db,
          subjectId,
        )
        return Response.json(chapters)
      },
    },
  },
})
