import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { resolveEnabledStudent } from '../../lib/access'
import { createDb } from '../../db/connection'
import { studentsRepository, remediationTasksRepository } from '../../db/repositories'

const querySchema = z.object({
  student_id: z.string().uuid().optional(),
})

/**
 * GET /api/remediation (tab06 /remediation "open drills") -- not in tab05, which never listed a
 * read route for this table. A student sees only their own linked profile's drills (no
 * student_id param can override that -- T09); a parent/admin must name the student_id and it is
 * checked against their own household.
 */
export const Route = createFileRoute('/api/remediation')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student', 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }

        const db = createDb()
        try {
          let studentId: string
          if (auth.role === 'student') {
            const student = await resolveEnabledStudent(db, auth.id)
            if (student instanceof Response) return student
            studentId = student.id
          } else {
            if (!parsed.data.student_id) {
              return Response.json(
                { error: 'student_id is required' },
                { status: 400 },
              )
            }
            const student = await studentsRepository.findById(
              db,
              auth.householdId,
              parsed.data.student_id,
            )
            if (!student) return new Response(null, { status: 404 })
            studentId = student.id
          }

          const tasks = await remediationTasksRepository.listForStudent(db, studentId)
          return Response.json({ tasks })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
