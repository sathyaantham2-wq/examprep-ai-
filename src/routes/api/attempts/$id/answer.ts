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
import { wrapRouteHandlers } from '../../../../lib/error-log'

const answerSchema = z.object({
  paper_question_id: z.string().uuid(),
  response_text: z.string().optional(),
  selected_option: z.string().optional(),
  time_spent_sec: z.number().int().nonnegative().optional(),
})

// F040 autosave: this endpoint IS the autosave — the client calls it on every change/blur and
// debounces client-side. The 2-second-response half of the AC is a client concern (no screens
// exist here to debounce from); the server side is one fast upsert per call.
export const Route = createFileRoute('/api/attempts/$id/answer')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const parsed = answerSchema.safeParse(await request.json())
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

        const slot = await paperQuestionsRepository.findById(
          db,
          parsed.data.paper_question_id,
        )
        if (!slot || slot.paper_id !== attempt.paper_id) {
          return Response.json(
            { error: 'That question is not part of this attempt' },
            { status: 400 },
          )
        }

        const saved = await attemptAnswersRepository.upsert(db, {
          attempt_id: attempt.id,
          paper_question_id: slot.id,
          response_text: parsed.data.response_text,
          selected_option: parsed.data.selected_option,
          time_spent_sec: parsed.data.time_spent_sec,
          source: 'typed',
        })
        return Response.json(saved)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/answer', ['PATCH'])
