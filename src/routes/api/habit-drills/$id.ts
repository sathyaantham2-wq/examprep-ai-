import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { resolveEnabledStudent } from '../../../lib/access'
import { getSharedDb } from '../../../db/connection'
import { habitDrillTasksRepository } from '../../../db/repositories'
import { loadHabitDrillView } from '../../../lib/habit-drills'

/**
 * GET /api/habit-drills/:id -- mirrors GET /api/remediation/:id's auth shape (T09): a student can
 * only load their own linked profile's task, a parent/admin can load any task within their
 * household via the student join.
 */
export const Route = createFileRoute('/api/habit-drills/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'student', 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        let task
        if (auth.role === 'student') {
          const student = await resolveEnabledStudent(db, auth.id)
          if (student instanceof Response) return student
          task = await habitDrillTasksRepository.findById(
            db,
            student.id,
            params.id,
          )
        } else {
          task = await db
            .selectFrom('habit_drill_tasks')
            .innerJoin(
              'students',
              'students.id',
              'habit_drill_tasks.student_id',
            )
            .selectAll('habit_drill_tasks')
            .where('students.household_id', '=', auth.householdId)
            .where('habit_drill_tasks.id', '=', params.id)
            .executeTakeFirst()
        }
        if (!task) return new Response(null, { status: 404 })

        const view = await loadHabitDrillView(db, task)
        return Response.json({
          id: task.id,
          habit_id: task.habit_id,
          status: task.status,
          passed: task.passed,
          created_at: task.created_at,
          completed_at: task.completed_at,
          ...view,
        })
      },
    },
  },
})
