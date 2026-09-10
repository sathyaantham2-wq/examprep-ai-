import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { studentsRepository, remediationTasksRepository } from '../../../db/repositories'
import { loadTaskView } from '../../../lib/remediation'

/**
 * GET /api/remediation/:id (tab06 /remediation) -- not in tab05. A student can only load their
 * own linked profile's task (no id lets them reach another student's); a parent/admin can load
 * any task within their household via the student join.
 */
export const Route = createFileRoute('/api/remediation/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'student', 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          let task
          if (auth.role === 'student') {
            const student = await studentsRepository.findByUserId(db, auth.id)
            if (!student) {
              return Response.json(
                { error: 'This login is not linked to a student profile' },
                { status: 403 },
              )
            }
            task = await remediationTasksRepository.findById(
              db,
              student.id,
              params.id,
            )
          } else {
            task = await db
              .selectFrom('remediation_tasks')
              .innerJoin('students', 'students.id', 'remediation_tasks.student_id')
              .selectAll('remediation_tasks')
              .where('students.household_id', '=', auth.householdId)
              .where('remediation_tasks.id', '=', params.id)
              .executeTakeFirst()
          }
          if (!task) return new Response(null, { status: 404 })

          const view = await loadTaskView(db, task)
          return Response.json({
            id: task.id,
            concept_id: task.concept_id,
            status: task.status,
            trigger_reason: task.trigger_reason,
            created_at: task.created_at,
            completed_at: task.completed_at,
            ...view,
          })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
