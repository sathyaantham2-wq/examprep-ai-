import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'

// F009: kept in sync with students.ts's create-time targetExamSchema shape.
const targetExamSchema = z.object({
  name: z.string().min(1),
  date: z.string().date(),
})

const updateStudentSchema = z
  .object({
    name: z.string().min(1),
    class: z.number().int().min(1).max(12),
    section: z.string().min(1).nullable(),
    roll_no: z.string().min(1).nullable(),
    board: z.string().min(1),
    school: z.string().min(1).nullable(),
    target_exams: z.array(targetExamSchema),
    // F010: "Toggle per student." A parent always retains their own access regardless -- this
    // column only ever gates the student login, enforced server-side in resolveEnabledStudent
    // (src/lib/access.ts), not by hiding a button.
    access_enabled: z.boolean(),
    // F121: "parent can raise the cap." null clears the override back to the documented default
    // (STUDENT_DAILY_GENERATION_COST_CAP_INR / _MONTHLY_ in src/lib/ai-metering.ts); a number sets
    // an explicit override, typically raising it above that default.
    generation_daily_cap_inr: z.number().nonnegative().nullable(),
    generation_monthly_cap_inr: z.number().nonnegative().nullable(),
  })
  .partial()

export const Route = createFileRoute('/api/students/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = updateStudentSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        // findById is scoped by household — a student id from another household resolves to
        // undefined here rather than ever being reachable for update.
        const existing = await studentsRepository.findById(
          db,
          auth.householdId,
          params.id,
        )
        if (!existing) return new Response(null, { status: 404 })

        // Kysely's set() forwards every key in the object verbatim, including one whose value
        // is `undefined` -- so target_exams is only added to the payload when it was actually
        // provided, rather than risk an explicit `undefined` reaching the query as a bind param.
        const { target_exams, ...rest } = parsed.data
        const updated = await studentsRepository.update(
          db,
          auth.householdId,
          params.id,
          {
            ...rest,
            ...(target_exams !== undefined
              ? { target_exams: JSON.stringify(target_exams) }
              : {}),
          },
        )
        return Response.json(updated)
      },
    },
  },
})
