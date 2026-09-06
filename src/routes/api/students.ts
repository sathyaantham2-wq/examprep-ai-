import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { createDb } from '../../db/connection'
import { studentsRepository } from '../../db/repositories'

// F009: target_exams is {name, date}[] -- no consumer reads its shape yet (no other feature
// exists to display or schedule against it), so this is the minimal shape the AC's "target exam
// dates" actually needs, not a guess at a richer one nothing calls for yet.
const targetExamSchema = z.object({
  name: z.string().min(1),
  date: z.string().date(),
})

const createStudentSchema = z.object({
  name: z.string().min(1),
  class: z.number().int().min(1).max(12),
  board: z.string().min(1),
  school: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  roll_no: z.string().min(1).optional(),
  target_exams: z.array(targetExamSchema).optional(),
})

export const Route = createFileRoute('/api/students')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          const students = await studentsRepository.list(db, auth.householdId)
          return Response.json(students)
        } finally {
          await db.destroy()
        }
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = createStudentSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const student = await studentsRepository.insert(db, {
            household_id: auth.householdId,
            name: parsed.data.name,
            class: parsed.data.class,
            board: parsed.data.board,
            school: parsed.data.school,
            section: parsed.data.section,
            roll_no: parsed.data.roll_no,
            target_exams: JSON.stringify(parsed.data.target_exams ?? []),
          })
          return Response.json(student, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
