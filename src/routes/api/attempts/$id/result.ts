import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import { attemptsRepository } from '../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../lib/error-log'

/**
 * GET /api/attempts/:id/result -- what a student may see after a paper whose marks were confirmed
 * on submission: her score and, per concept, how many questions and where that concept now stands.
 * Deliberately no per-question correct answers or answer key (CLAUDE.md hard rule, T09). Returns
 * { evaluated: false } while a parent still has to confirm the marks.
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
          .select(['l.concept_id', 'c.name as concept_name', 'l.marks_awarded', 'l.marks_max'])
          .where('l.evaluation_id', '=', evaluation.id)
          .where('l.student_id', '=', student.id)
          .execute()

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
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/result', ['GET'])
