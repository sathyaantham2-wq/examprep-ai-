import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { resolveEnabledStudent } from '../../../lib/access'
import { getSharedDb } from '../../../db/connection'
import { wrapRouteHandlers } from '../../../lib/error-log'

// The signed-in student's own profile: just what the paper generator needs (class and board).
export const Route = createFileRoute('/api/students/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const student = await resolveEnabledStudent(getSharedDb(), auth.id)
        if (student instanceof Response) return student
        return Response.json({
          id: student.id,
          name: student.name,
          class: student.class,
          board: student.board,
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/students/me', ['GET'])
