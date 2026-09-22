import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import {
  attemptsRepository,
  paperQuestionsRepository,
  attemptAnswersRepository,
} from '../../../../db/repositories'
import { logProductEvent } from '../../../../lib/product-events'
import { autoConfirmAttempt } from '../../../../lib/adaptive/auto-confirm'
import { getPointsEarnedForEvaluation } from '../../../../lib/points'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const submitSchema = z.object({
  // Set once the student has seen the "you have N blank answers" warning and chosen to proceed
  // anyway — this is the server-side half of F043/T11: the block is real, not just a UI nag.
  confirm_blanks: z.boolean().optional(),
})

export const Route = createFileRoute('/api/attempts/$id/submit')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const parsed = submitSchema.safeParse(
          await request.text().then((text) => (text ? JSON.parse(text) : {})),
        )
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student

        const attempt = await attemptsRepository.findById(
          db,
          student.id,
          params.id,
        )
        if (!attempt) return new Response(null, { status: 404 })
        if (attempt.status !== 'in_progress') {
          return Response.json(
            { error: 'This attempt is already closed' },
            { status: 409 },
          )
        }

        const [slots, answers] = await Promise.all([
          paperQuestionsRepository.listForPaperWithQuestions(
            db,
            attempt.paper_id,
          ),
          attemptAnswersRepository.listForAttempt(db, attempt.id),
        ])
        const answeredSlotIds = new Set(
          answers
            .filter(
              (a) =>
                (a.response_text?.trim() ?? '') !== '' || a.selected_option,
            )
            .map((a) => a.paper_question_id),
        )
        const blankPositions = slots
          .filter((slot) => !answeredSlotIds.has(slot.id))
          .map((slot) => slot.position)
          .sort((a, b) => a - b)

        if (blankPositions.length > 0 && !parsed.data.confirm_blanks) {
          return Response.json(
            {
              error: 'blank_answers',
              message: `You have ${blankPositions.length} blank answer(s)`,
              blank_positions: blankPositions,
            },
            { status: 409 },
          )
        }

        const durationUsedSec = Math.floor(
          (Date.now() - new Date(attempt.started_at).getTime()) / 1000,
        )
        const updated = await attemptsRepository.update(
          db,
          student.id,
          attempt.id,
          {
            status: 'submitted',
            submitted_at: new Date(),
            duration_used_sec: durationUsedSec,
          },
        )

        await logProductEvent(db, {
          eventType: 'attempt_submitted',
          householdId: student.household_id,
          studentId: student.id,
        })

        // Adaptive practice is marked with no parent: multiple-choice papers are confirmed at once,
        // and written answers are marked by the AI for the student to review. Every other paper
        // waits for a parent.
        const outcome = await autoConfirmAttempt(db, attempt)
        // F125: only ever set for the all-MCQ adaptive-paper path (the only case that
        // auto-confirms, hence pays out, at submit time) -- null for a review-pending or a
        // parent-gated paper, where nothing has actually earned anything YET.
        const pointsEarned = outcome.evaluationId
          ? await getPointsEarnedForEvaluation(db, outcome.evaluationId)
          : null

        return Response.json({
          ...updated,
          evaluation_id: outcome.evaluationId,
          review_pending: outcome.reviewPending,
          points_earned: pointsEarned,
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/submit', ['POST'])
