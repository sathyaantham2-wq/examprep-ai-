import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { createDb } from '../../db/connection'
import {
  studentsRepository,
  papersRepository,
  attemptsRepository,
} from '../../db/repositories'

const createAttemptSchema = z.object({
  paper_id: z.string().uuid(),
  mode: z.enum(['online', 'uploaded']),
})

// tab05: request is just {paper_id, mode} — no student_id, because a student can only ever
// attempt as themselves. "Which student" comes from the session, not the request body.
export const Route = createFileRoute('/api/attempts')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const parsed = createAttemptSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const student = await studentsRepository.findByUserId(db, auth.id)
          if (!student) {
            return Response.json(
              { error: 'This login is not linked to a student profile' },
              { status: 403 },
            )
          }

          // Scoped by student_id — a paper belonging to a different student resolves to
          // undefined, so a student can't start an attempt on someone else's paper.
          const paper = await papersRepository.findById(
            db,
            student.id,
            parsed.data.paper_id,
          )
          if (!paper) return new Response(null, { status: 404 })

          const attempt = await attemptsRepository.insert(db, {
            paper_id: paper.id,
            student_id: student.id,
            mode: parsed.data.mode,
            status: 'in_progress',
          })
          return Response.json(attempt, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
