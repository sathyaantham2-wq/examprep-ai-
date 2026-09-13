import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import {
  studentsRepository,
  conceptStatusRepository,
} from '../../../db/repositories'

const CONCEPT_STATUSES = [
  'Strong',
  'Needs Practice',
  'Weak',
  'Priority',
  'Maintenance',
] as const

export const Route = createFileRoute('/api/tracker/$studentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsedQuery = z
          .object({
            subject_id: z.string().uuid().optional(),
            status: z.enum(CONCEPT_STATUSES).optional(),
          })
          .safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!parsedQuery.success) {
          return Response.json(
            { error: parsedQuery.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        // findById is household-scoped — a student id from another household resolves to
        // undefined, same pattern as PATCH /api/students/:id.
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          params.studentId,
        )
        if (!student) return new Response(null, { status: 404 })

        const rows = await conceptStatusRepository.listForStudentWithFilter(
          db,
          params.studentId,
          {
            subjectId: parsedQuery.data.subject_id,
            status: parsedQuery.data.status,
          },
        )
        return Response.json(rows)
      },
    },
  },
})
