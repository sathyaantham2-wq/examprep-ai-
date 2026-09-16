import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { resolveEnabledStudent } from '../../../lib/access'
import { getSharedDb } from '../../../db/connection'
import {
  attemptsRepository,
  papersRepository,
  paperQuestionsRepository,
  questionOptionsRepository,
  attemptAnswersRepository,
} from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

/**
 * GET /api/attempts/:id -- everything the test runner (M08) needs to render and resume an
 * in-progress attempt. Student-only, and this is the one place in the whole product where the
 * hard rule "a student can never see or download an answer key" (CLAUDE.md, T09) is actually load
 * -bearing at the wire level: paperQuestionsRepository.listForPaperWithQuestions selects
 * questions.answer, and questionOptionsRepository.listByQuestion selects is_correct, because both
 * are legitimately needed for evaluation elsewhere -- so this handler builds its own narrow
 * projection rather than spreading either result, and never touches `answer` or `is_correct` at
 * all rather than trying to remember to delete them.
 */
export const Route = createFileRoute('/api/attempts/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student

        const attempt = await attemptsRepository.findById(
          db,
          student.id,
          params.id,
        )
        if (!attempt) return new Response(null, { status: 404 })

        const paper = await papersRepository.findById(
          db,
          student.id,
          attempt.paper_id,
        )
        if (!paper) return new Response(null, { status: 404 })

        const [slots, answers] = await Promise.all([
          paperQuestionsRepository.listForPaperWithQuestions(
            db,
            attempt.paper_id,
          ),
          attemptAnswersRepository.listForAttempt(db, attempt.id),
        ])

        const optionsByQuestion = new Map(
          await Promise.all(
            slots.map(async (slot) => {
              const options = await questionOptionsRepository.listByQuestion(
                db,
                slot.question_id,
              )
              return [
                slot.question_id,
                options.map((o) => ({ label: o.label, text: o.text })),
              ] as const
            }),
          ),
        )
        const answerBySlot = new Map(
          answers.map((a) => [a.paper_question_id, a]),
        )

        return Response.json({
          attempt: {
            id: attempt.id,
            status: attempt.status,
            mode: attempt.mode,
            started_at: attempt.started_at,
          },
          paper: {
            id: paper.id,
            title: paper.title,
            duration_min: paper.duration_min,
            total_marks: paper.total_marks,
          },
          questions: slots.map((slot) => ({
            paper_question_id: slot.id,
            position: slot.position,
            section: slot.section,
            marks: slot.marks,
            type: slot.type,
            text: slot.text,
            hint: slot.hint,
            diagram_kind: slot.diagram_kind,
            diagram_params: slot.diagram_params,
            options: optionsByQuestion.get(slot.question_id) ?? [],
            saved_answer: (() => {
              const saved = answerBySlot.get(slot.id)
              return saved
                ? {
                    response_text: saved.response_text,
                    selected_option: saved.selected_option,
                  }
                : null
            })(),
          })),
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id', ['GET'])
