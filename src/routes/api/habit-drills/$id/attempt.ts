import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { createDb } from '../../../../db/connection'
import { submitHabitDrillAttempt } from '../../../../lib/habit-drills'

const requestSchema = z.object({
  answers: z.array(
    z.object({
      question_id: z.string().uuid(),
      selected_option: z.string().optional(),
      response_text: z.string().optional(),
    }),
  ),
})

const REASON_STATUS: Record<string, number> = {
  not_found: 404,
  already_completed: 409,
}

// F070: POST /api/habit-drills/:id/attempt -- student-only, scores the drill immediately against
// its kind-specific pass criteria (never through the concept evaluation/mastery pipeline -- see
// submitHabitDrillAttempt's own note on why).
export const Route = createFileRoute('/api/habit-drills/$id/attempt')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const parsed = requestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }

        const db = createDb()
        try {
          const student = await resolveEnabledStudent(db, auth.id)
          if (student instanceof Response) return student

          const result = await submitHabitDrillAttempt(db, {
            taskId: params.id,
            studentId: student.id,
            answers: parsed.data.answers,
          })

          if (!result.ok) {
            return Response.json(
              { error: result.reason },
              { status: REASON_STATUS[result.reason] },
            )
          }

          return Response.json(result)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
