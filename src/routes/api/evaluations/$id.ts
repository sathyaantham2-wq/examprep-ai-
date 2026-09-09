import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import {
  evaluationsRepository,
  evaluationItemsRepository,
  attemptAnswersRepository,
  questionOptionsRepository,
} from '../../../db/repositories'

/**
 * GET /api/evaluations/:id -- everything the evaluation review workspace (F048) needs to render
 * one screen: the evaluation header, and every item merged with its question's text/type/answer,
 * the student's actual response, and the options (with is_correct -- unlike the student-facing
 * GET /api/attempts/:id, a parent reviewing marks is exactly who this is meant for, per CLAUDE.md:
 * only the student role can never see the answer key).
 */
export const Route = createFileRoute('/api/evaluations/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          const evaluation = await evaluationsRepository.findByIdForHousehold(
            db,
            auth.householdId,
            params.id,
          )
          if (!evaluation) return new Response(null, { status: 404 })

          const [items, answers] = await Promise.all([
            evaluationItemsRepository.listForEvaluation(db, evaluation.id),
            attemptAnswersRepository.listForAttempt(db, evaluation.attempt_id),
          ])
          const answerBySlot = new Map(
            answers.map((a) => [a.paper_question_id, a]),
          )

          const questionRows =
            items.length > 0
              ? await db
                  .selectFrom('paper_questions')
                  .innerJoin(
                    'questions',
                    'questions.id',
                    'paper_questions.question_id',
                  )
                  .select([
                    'paper_questions.id as paper_question_id',
                    'paper_questions.position',
                    'paper_questions.section',
                    'questions.id as question_id',
                    'questions.type',
                    'questions.text',
                    'questions.answer',
                  ])
                  .where(
                    'paper_questions.id',
                    'in',
                    items.map((i) => i.paper_question_id),
                  )
                  .execute()
              : []
          const questionByPq = new Map(
            questionRows.map((q) => [q.paper_question_id, q]),
          )

          const optionsByQuestion = new Map(
            await Promise.all(
              questionRows.map(
                async (q) =>
                  [
                    q.question_id,
                    await questionOptionsRepository.listByQuestion(
                      db,
                      q.question_id,
                    ),
                  ] as const,
              ),
            ),
          )

          return Response.json({
            evaluation,
            items: items
              .map((item) => {
                const q = questionByPq.get(item.paper_question_id)
                const answer = answerBySlot.get(item.paper_question_id)
                return {
                  ...item,
                  position: q?.position ?? null,
                  section: q?.section ?? null,
                  question_text: q?.text ?? null,
                  question_type: q?.type ?? null,
                  correct_answer: q?.answer ?? null,
                  options: q
                    ? (optionsByQuestion.get(q.question_id) ?? [])
                    : [],
                  student_answer: answer
                    ? {
                        selected_option: answer.selected_option,
                        response_text: answer.response_text,
                      }
                    : null,
                }
              })
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
          })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
