import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { createEvaluation } from '../../lib/evaluation'
import { createDb } from '../../db/connection'

const createEvaluationSchema = z.object({
  attempt_id: z.string().uuid(),
})

export const Route = createFileRoute('/api/evaluations')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = createEvaluationSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          // attempts is scoped by student_id, not household_id, but a parent doesn't know their
          // student's internal id just from an attempt_id — join through students instead.
          const attempt = await db
            .selectFrom('attempts')
            .innerJoin('students', 'students.id', 'attempts.student_id')
            .selectAll('attempts')
            .where('students.household_id', '=', auth.householdId)
            .where('attempts.id', '=', parsed.data.attempt_id)
            .executeTakeFirst()
          if (!attempt) return new Response(null, { status: 404 })

          if (attempt.status !== 'submitted') {
            return Response.json(
              { error: 'Attempt must be submitted before it can be evaluated' },
              { status: 409 },
            )
          }

          const result = await createEvaluation(db, attempt.id)
          return Response.json(result, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
