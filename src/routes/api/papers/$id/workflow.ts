import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import {
  papersRepository,
  paperQuestionsRepository,
  chaptersRepository,
} from '../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../lib/error-log'

/**
 * Parent-only view of one generated paper and how far it has got through the loop:
 * generated -> student attempts -> submitted -> parent reviews marks -> confirmed report.
 * Household-scoped exactly like GET /api/papers/:id (a paper from another household is a 404).
 * The student role is rejected here, so answer keys never reach a student.
 */
export const Route = createFileRoute('/api/papers/$id/workflow')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'teacher', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const paper = await papersRepository.findByIdForHousehold(
          db,
          auth.householdId,
          params.id,
        )
        if (!paper) return new Response(null, { status: 404 })

        const [questions, chapters, student, attempts] = await Promise.all([
          paperQuestionsRepository.listForPaperWithQuestions(db, paper.id),
          chaptersRepository.listByIds(db, paper.chapter_ids),
          db
            .selectFrom('students')
            .select(['id', 'name'])
            .where('id', '=', paper.student_id)
            .executeTakeFirst(),
          db
            .selectFrom('attempts')
            .leftJoin('evaluations', 'evaluations.attempt_id', 'attempts.id')
            .select([
              'attempts.id',
              'attempts.mode',
              'attempts.status',
              'attempts.started_at',
              'attempts.submitted_at',
              'evaluations.id as evaluation_id',
              'evaluations.confirmed_at',
              'evaluations.percentage',
              'evaluations.actual_score',
              'evaluations.total_marks',
            ])
            .where('attempts.paper_id', '=', paper.id)
            .orderBy('attempts.started_at', 'desc')
            .execute(),
        ])

        const mcqIds = questions
          .filter((q) => q.type === 'mcq')
          .map((q) => q.question_id)
        const options =
          mcqIds.length === 0
            ? []
            : await db
                .selectFrom('question_options')
                .select(['question_id', 'label', 'text', 'is_correct', 'order_index'])
                .where('question_id', 'in', mcqIds)
                .orderBy('order_index')
                .execute()

        return Response.json({
          paper: {
            id: paper.id,
            title: paper.title,
            total_marks: paper.total_marks,
            duration_min: paper.duration_min,
          },
          student,
          chapters,
          questions: questions.map((q) => ({
            id: q.id,
            section: q.section,
            position: q.position,
            marks: q.marks,
            type: q.type,
            bloom: q.bloom,
            text: q.text,
            answer: q.answer,
            options: options.filter((o) => o.question_id === q.question_id),
          })),
          attempts,
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/papers/$id/workflow', ['GET'])
