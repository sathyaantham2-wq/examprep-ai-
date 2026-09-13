import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { createEvaluation } from '../../lib/evaluation'
import { getSharedDb } from '../../db/connection'
import {
  evaluationsRepository,
  evaluationItemsRepository,
} from '../../db/repositories'
import { logProductEvent } from '../../lib/product-events'

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

        const db = getSharedDb()
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

        // createEvaluation() never flips attempts.status -- only confirmEvaluation() does --
        // so an attempt stays 'submitted' the whole time an evaluation exists for it but
        // hasn't been confirmed. Re-checking here rather than relying on attempt.status alone
        // means reopening the review screen returns the same evaluation instead of creating a
        // second, orphaned one for the same attempt.
        const existing = await evaluationsRepository.findByAttemptId(
          db,
          attempt.id,
        )
        if (existing) {
          const items = await evaluationItemsRepository.listForEvaluation(
            db,
            existing.id,
          )
          return Response.json({ evaluation: existing, items }, { status: 200 })
        }

        if (attempt.status !== 'submitted') {
          return Response.json(
            { error: 'Attempt must be submitted before it can be evaluated' },
            { status: 409 },
          )
        }

        const result = await createEvaluation(db, attempt.id)

        await logProductEvent(db, {
          eventType: 'evaluation_completed',
          householdId: auth.householdId,
          studentId: attempt.student_id,
        })

        return Response.json(result, { status: 201 })
      },
    },
  },
})
