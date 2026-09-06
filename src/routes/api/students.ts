import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { createDb } from '../../db/connection'
import { studentsRepository, consentsRepository } from '../../db/repositories'
import { CURRENT_CONSENT_VERSION } from '../../lib/consent'

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
  // F095: DPDP consent is captured at student creation -- must be an explicit true, not merely
  // present/truthy, so a client can't satisfy this by sending consent_accepted: "no".
  consent_accepted: z.literal(true, {
    error: 'Parental consent is required to create a student profile',
  }),
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
          // F095: the student profile and its consent record are created atomically -- a student
          // row must never exist without a matching consent event.
          const student = await db.transaction().execute(async (trx) => {
            const created = await studentsRepository.insert(trx, {
              household_id: auth.householdId,
              name: parsed.data.name,
              class: parsed.data.class,
              board: parsed.data.board,
              school: parsed.data.school,
              section: parsed.data.section,
              roll_no: parsed.data.roll_no,
              target_exams: JSON.stringify(parsed.data.target_exams ?? []),
            })
            await consentsRepository.insert(trx, {
              household_id: auth.householdId,
              student_id: created.id,
              given_by_user_id: auth.id,
              purpose_version: CURRENT_CONSENT_VERSION,
            })
            return created
          })
          return Response.json(student, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
