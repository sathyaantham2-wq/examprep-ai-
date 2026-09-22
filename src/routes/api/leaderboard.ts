import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../lib/session'
import { resolveEnabledStudent } from '../../lib/access'
import { getSharedDb } from '../../db/connection'
import { getLeaderboard } from '../../lib/leaderboard'
import { wrapRouteHandlers } from '../../lib/error-log'

// F125 (second slice). Student-self only for now -- a parent-facing "view any of my students'
// leaderboards" variant (the pattern F123 already established for GET /api/papers) is a
// reasonable follow-up, not built this pass. subject_id must be one of HER OWN (board, class)
// subjects: a student guessing a different class's subject_id gets 404, not another cohort's
// leaderboard.
export const Route = createFileRoute('/api/leaderboard')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const student = await resolveEnabledStudent(getSharedDb(), auth.id)
        if (student instanceof Response) return student

        const url = new URL(request.url)
        const subjectId = url.searchParams.get('subject_id')
        if (!subjectId) {
          return Response.json({ error: 'subject_id is required' }, { status: 400 })
        }

        const db = getSharedDb()
        const subject = await db
          .selectFrom('subjects')
          .select('id')
          .where('id', '=', subjectId)
          .where('board', '=', student.board)
          .where('class', '=', student.class)
          .executeTakeFirst()
        if (!subject) return new Response(null, { status: 404 })

        const view = await getLeaderboard(db, subjectId, student.id)
        return Response.json(view)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/leaderboard', ['GET'])
