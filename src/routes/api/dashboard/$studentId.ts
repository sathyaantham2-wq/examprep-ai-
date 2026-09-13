import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'
import { buildParentDashboard } from '../../../lib/dashboard'

// tab05: GET /api/dashboard/:studentId, Parent -> subject cards, gap trend, priority concepts,
// next actions. No screen exists in this repo (none do) -- this is the data half only.
export const Route = createFileRoute('/api/dashboard/$studentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          params.studentId,
        )
        if (!student) return new Response(null, { status: 404 })

        const dashboard = await buildParentDashboard(db, student.id)
        return Response.json(dashboard)
      },
    },
  },
})
