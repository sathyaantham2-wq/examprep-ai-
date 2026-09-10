import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../lib/session'
import { createDb } from '../../db/connection'
import { studentsRepository } from '../../db/repositories'
import { buildStudentDashboard } from '../../lib/student-dashboard'

/**
 * F072 (tab06 /student): GET /api/student-dashboard, not in tab05 (predates this feature). No
 * :id param — always resolves to the calling student's own linked profile via
 * studentsRepository.findByUserId, the same pattern POST /api/attempts uses, so there is no id a
 * student could substitute to read another student's data (T09).
 */
export const Route = createFileRoute('/api/student-dashboard')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          const student = await studentsRepository.findByUserId(db, auth.id)
          if (!student) {
            return Response.json(
              { error: 'This login is not linked to a student profile' },
              { status: 403 },
            )
          }

          const dashboard = await buildStudentDashboard(db, student.id)
          return Response.json(dashboard)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
