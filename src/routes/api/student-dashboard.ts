import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../lib/session'
import { resolveEnabledStudent } from '../../lib/access'
import { createDb } from '../../db/connection'
import { buildStudentDashboard } from '../../lib/student-dashboard'

/**
 * F072 (tab06 /student): GET /api/student-dashboard, not in tab05 (predates this feature). No
 * :id param — always resolves to the calling student's own linked profile via
 * resolveEnabledStudent (src/lib/access.ts), the same pattern POST /api/attempts uses, so there is
 * no id a student could substitute to read another student's data (T09), and a disabled student
 * (F010) gets locked out here too.
 */
export const Route = createFileRoute('/api/student-dashboard')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          const student = await resolveEnabledStudent(db, auth.id)
          if (student instanceof Response) return student

          const dashboard = await buildStudentDashboard(db, student.id)
          return Response.json(dashboard)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
