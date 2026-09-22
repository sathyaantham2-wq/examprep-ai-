import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import { attemptsRepository } from '../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../lib/error-log'

/**
 * GET /api/attempts/:id/result -- what a student may see after a paper whose marks were confirmed
 * on submission: her score, per-question marks and the correct answer for each question, and per
 * concept, how many questions and where that concept now stands.
 *
 * CLAUDE.md's T09 hard rule ("never see or download an answer key") was amended by the user,
 * 2026-09-22: once her own attempt is submitted and confirmed, seeing the correct answer next to
 * her own is how she learns from it -- including for a question that gets re-served later and she
 * simply remembers it, which the user was explicit is fine (the point is learning, not testing
 * recall of one specific item). This still never applies before or during an attempt (GET
 * /api/attempts/:id, unchanged, still never selects `answer`/`is_correct`), never as a
 * downloadable/printable key, and never to another student's data.
 */
export const Route = createFileRoute('/api/attempts/$id/result')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student

        const attempt = await attemptsRepository.findById(db, student.id, params.id)
        if (!attempt) return new Response(null, { status: 404 })

        const evaluation = await db
          .selectFrom('evaluations')
          .select(['id', 'actual_score', 'total_marks', 'percentage', 'confirmed_at'])
          .where('attempt_id', '=', attempt.id)
          .where('confirmed_at', 'is not', null)
          .executeTakeFirst()
        if (!evaluation) return Response.json({ evaluated: false })

        const answers = await db
          .selectFrom('concept_answer_log as l')
          .innerJoin('concepts as c', 'c.id', 'l.concept_id')
          .select([
            'l.paper_question_id',
            'l.question_id',
            'l.concept_id',
            'c.name as concept_name',
            'l.marks_awarded',
            'l.marks_max',
          ])
          .where('l.evaluation_id', '=', evaluation.id)
          .where('l.student_id', '=', student.id)
          .execute()

        // The correct answer for each question she answered -- see this file's own doc comment
        // for why this is allowed post-confirmation. MCQ: the option marked is_correct. Written:
        // the question's own reference/model answer (the same text the AI grader is given).
        const questionIds = [...new Set(answers.map((a) => a.question_id))]
        const [questionRows, correctOptions] = await Promise.all([
          questionIds.length > 0
            ? db
                .selectFrom('questions')
                .select(['id', 'type', 'answer'])
                .where('id', 'in', questionIds)
                .execute()
            : Promise.resolve([]),
          questionIds.length > 0
            ? db
                .selectFrom('question_options')
                .select(['question_id', 'label', 'text'])
                .where('question_id', 'in', questionIds)
                .where('is_correct', '=', true)
                .execute()
            : Promise.resolve([]),
        ])
        const questionById = new Map(questionRows.map((q) => [q.id, q]))
        const correctOptionByQuestion = new Map(
          correctOptions.map((o) => [o.question_id, o]),
        )
        const correctAnswerFor = (questionId: string): string | null => {
          const question = questionById.get(questionId)
          if (!question) return null
          if (question.type === 'mcq') {
            const opt = correctOptionByQuestion.get(questionId)
            return opt ? `${opt.label}. ${opt.text}` : null
          }
          return question.answer
        }

        const byConcept = new Map<
          string,
          { concept_id: string; concept_name: string; questions: number; marks: number; marks_max: number }
        >()
        for (const a of answers) {
          const row = byConcept.get(a.concept_id) ?? {
            concept_id: a.concept_id,
            concept_name: a.concept_name,
            questions: 0,
            marks: 0,
            marks_max: 0,
          }
          row.questions += 1
          row.marks += Number(a.marks_awarded)
          row.marks_max += Number(a.marks_max)
          byConcept.set(a.concept_id, row)
        }

        const concepts = []
        for (const row of byConcept.values()) {
          const history = await db
            .selectFrom('mastery_history')
            .select(['mastery_level', 'mastery_score', 'current_difficulty', 'evaluation_id'])
            .where('student_id', '=', student.id)
            .where('concept_id', '=', row.concept_id)
            .orderBy('created_at', 'desc')
            .limit(2)
            .execute()
          const now = history.find((h) => h.evaluation_id === evaluation.id)
          const before = history.find((h) => h.evaluation_id !== evaluation.id)
          concepts.push({
            ...row,
            mastery_level: now?.mastery_level ?? null,
            mastery_score: now ? Number(now.mastery_score) : null,
            next_difficulty: now?.current_difficulty ?? null,
            previous_level: before?.mastery_level ?? null,
          })
        }

        return Response.json({
          evaluated: true,
          score: Number(evaluation.actual_score ?? 0),
          total_marks: Number(evaluation.total_marks),
          percentage: Number(evaluation.percentage ?? 0),
          concepts,
          questions: answers.map((a) => ({
            paper_question_id: a.paper_question_id,
            marks_awarded: Number(a.marks_awarded),
            marks_max: Number(a.marks_max),
            correct_answer: correctAnswerFor(a.question_id),
          })),
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/result', ['GET'])
