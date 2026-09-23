import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import { attemptsRepository } from '../../../../db/repositories'
import { getOrCreateExplanation } from '../../../../lib/explanations'
import {
  StudentSpendCapReachedError,
  enforceStudentSpendBudget,
} from '../../../../lib/ai-metering'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const bodySchema = z.object({ paper_question_id: z.string().uuid() })

/**
 * POST /api/attempts/:id/explanation -- F126. The worked explanation for one question on one of
 * her own finished papers, generated on first request and cached per question thereafter
 * (src/lib/explanations.ts).
 *
 * Three gates, all server-side, in this order:
 *   1. the attempt is hers (attemptsRepository.findById is scoped to her student id),
 *   2. its evaluation exists and is CONFIRMED -- the T09 amendment only permits showing the
 *      correct answer, and therefore an explanation of it, once her marks are final; before that
 *      this is indistinguishable from handing her the answer key mid-paper,
 *   3. the question is actually one of the slots on that paper -- otherwise any question id in
 *      the bank could be explained by asking about it through an attempt she happens to own.
 *
 * Lazy by design: nothing is generated for questions she never asks about, which is what makes
 * explaining a bank of ~8,000 approved MCQs affordable at all.
 */
export const Route = createFileRoute('/api/attempts/$id/explanation')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student

        const parsed = bodySchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const attempt = await attemptsRepository.findById(
          db,
          student.id,
          params.id,
        )
        if (!attempt) return new Response(null, { status: 404 })

        const evaluation = await db
          .selectFrom('evaluations')
          .select(['id'])
          .where('attempt_id', '=', attempt.id)
          .where('confirmed_at', 'is not', null)
          .executeTakeFirst()
        if (!evaluation) {
          return Response.json(
            {
              error: 'not_confirmed',
              message: 'Marks for this paper are not final yet.',
            },
            { status: 409 },
          )
        }

        const slot = await db
          .selectFrom('paper_questions')
          .select(['id', 'question_id'])
          .where('id', '=', parsed.data.paper_question_id)
          .where('paper_id', '=', attempt.paper_id)
          .executeTakeFirst()
        if (!slot) return new Response(null, { status: 404 })

        // F121: the same spend ceiling her paper generation and grading are charged against.
        try {
          await enforceStudentSpendBudget(db, { studentId: student.id })
        } catch (err) {
          if (err instanceof StudentSpendCapReachedError) {
            return Response.json(
              { error: 'spend_cap_exceeded', message: err.message },
              { status: 429 },
            )
          }
          throw err
        }

        const answer = await db
          .selectFrom('attempt_answers')
          .select(['response_text', 'selected_option'])
          .where('attempt_id', '=', attempt.id)
          .where('paper_question_id', '=', slot.id)
          .executeTakeFirst()

        const explanation = await getOrCreateExplanation(db, {
          questionId: slot.question_id,
          householdId: student.household_id,
          studentId: student.id,
          studentAnswer:
            answer?.selected_option ?? answer?.response_text ?? null,
        })

        if (!explanation) {
          return Response.json(
            {
              error: 'unavailable',
              message: 'An explanation for this question is not available yet.',
            },
            { status: 503 },
          )
        }

        return Response.json({
          paper_question_id: slot.id,
          explanation: explanation.explanation,
          source: explanation.source,
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/explanation', ['POST'])
