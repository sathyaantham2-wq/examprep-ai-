import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'
import { buildHabitDrill } from '../../../lib/habit-drills'
import { wrapRouteHandlers } from '../../../lib/error-log'

const requestSchema = z.object({
  student_id: z.string().uuid(),
  habit_id: z.string().uuid(),
})

const REASON_MESSAGES: Record<string, { status: number; message: string }> = {
  habit_not_found: { status: 404, message: 'Habit not found' },
  no_drill_for_habit: {
    status: 422,
    message: 'No micro-drill is defined for this habit',
  },
  not_triggered: {
    status: 422,
    message:
      "This habit's two most recent ratings for this student are not both present/partial-or-absent -- nothing to drill yet",
  },
  no_questions_available: {
    status: 422,
    message: 'No approved questions of the right type exist for this drill yet',
  },
}

// F070: POST /api/habit-drills/generate, Parent, {student_id, habit_id} -> a habit micro-drill
// task -- mirrors POST /api/remediation/generate's shape (F066) exactly.
export const Route = createFileRoute('/api/habit-drills/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = requestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          parsed.data.student_id,
        )
        if (!student) return new Response(null, { status: 404 })

        const result = await buildHabitDrill(db, {
          studentId: student.id,
          habitId: parsed.data.habit_id,
        })

        if (!result.ok) {
          const { status, message } = REASON_MESSAGES[result.reason]
          return Response.json({ error: message }, { status })
        }

        return Response.json(result, { status: 201 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/habit-drills/generate', ['POST'])
