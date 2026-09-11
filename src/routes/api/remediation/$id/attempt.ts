import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { createDb } from '../../../../db/connection'
import { submitDrillAttempt } from '../../../../lib/remediation'

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
  concept_not_found: 404,
}

// F068: POST /api/remediation/:id/attempt -- not in tab05. Student-only: scores the drill
// immediately (every drill question is objective) and confirms it in the same call, writing back
// to the concept ledger, so the response already reflects whether Priority cleared or held.
export const Route = createFileRoute('/api/remediation/$id/attempt')({
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

          const result = await submitDrillAttempt(db, {
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
