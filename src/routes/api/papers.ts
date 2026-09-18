import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '../../lib/session'
import { resolveEnabledStudent } from '../../lib/access'
import { getSharedDb } from '../../db/connection'
import {
  papersRepository,
  attemptsRepository,
  studentsRepository,
} from '../../db/repositories'
import { wrapRouteHandlers } from '../../lib/error-log'

/**
 * F123 (M08): the missing entry point into the online test engine. F039 built the timed
 * attempt runner (/attempt/:id) and F112 gave students permission to generate and attempt
 * papers, but nothing ever listed which papers exist for a student to click into -- a generated
 * paper's id was only ever visible inside a raw POST /api/papers/generate response, never
 * discoverable afterwards. Discovered live: a real paper generated for a real student had no UI
 * path to actually start it.
 *
 * Deliberately answer-free and question-free -- this is "which papers exist and their attempt
 * status", not paper detail. GET /api/papers/:id (parent/admin-only, includes the answer key) is
 * the right place for that; a student must never reach an answer key, per CLAUDE.md's hard rule.
 */
export const Route = createFileRoute('/api/papers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request)
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        let studentId: string

        if (auth.role === 'student') {
          const student = await resolveEnabledStudent(db, auth.id)
          if (student instanceof Response) return student
          studentId = student.id
        } else {
          // UserRole is exhaustively 'parent' | 'student' | 'admin' -- having excluded 'student'
          // above, this branch covers both remaining roles, matching the same pair
          // POST /api/papers/generate already accepts alongside 'student'.
          const requested = new URL(request.url).searchParams.get(
            'student_id',
          )
          if (!requested) {
            return Response.json(
              { error: 'student_id query param is required' },
              { status: 400 },
            )
          }
          const student = await studentsRepository.findById(
            db,
            auth.householdId,
            requested,
          )
          if (!student) return new Response(null, { status: 404 })
          studentId = student.id
        }

        const [papers, attempts] = await Promise.all([
          papersRepository.list(db, studentId),
          attemptsRepository.list(db, studentId),
        ])

        // Most recent attempt per paper -- a resumed/retried paper only needs its latest state,
        // and started_at is a real server timestamp (never client-suppliable) so this is stable.
        const latestAttemptByPaper = new Map<string, (typeof attempts)[number]>()
        for (const attempt of attempts) {
          const existing = latestAttemptByPaper.get(attempt.paper_id)
          if (!existing || attempt.started_at > existing.started_at) {
            latestAttemptByPaper.set(attempt.paper_id, attempt)
          }
        }

        const items = papers
          .map((paper) => {
            const attempt = latestAttemptByPaper.get(paper.id)
            return {
              id: paper.id,
              title: paper.title,
              total_marks: paper.total_marks,
              duration_min: paper.duration_min,
              generated_at: paper.generated_at,
              attempt: attempt
                ? { id: attempt.id, status: attempt.status }
                : null,
            }
          })
          .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))

        return Response.json(items)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/papers', ['GET'])
