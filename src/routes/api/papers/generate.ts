import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { generatePaper } from '../../../lib/papers'
import { createDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'

const DIFFICULTY_TIERS = ['Easy', 'Hard', 'Hardest'] as const

const weightingSchema = z
  .object({
    weak_priority: z.number().min(0).max(100),
    needs_practice: z.number().min(0).max(100),
    strong: z.number().min(0).max(100),
  })
  .refine(
    (w) => Math.abs(w.weak_priority + w.needs_practice + w.strong - 100) < 0.01,
    {
      message: 'weighting must sum to 100',
    },
  )

const generateSchema = z.object({
  student_id: z.string().uuid(),
  blueprint_id: z.string().uuid(),
  chapter_ids: z.array(z.string().uuid()).min(1),
  theme: z.string().min(1).optional(),
  // F119: this is a ceiling on difficulty, never a filter on which concepts get picked.
  difficulty_ceiling: z.enum(DIFFICULTY_TIERS).optional(),
  weighting_override: weightingSchema.optional(),
})

export const Route = createFileRoute('/api/papers/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = generateSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          // household-scoped: a parent can only generate papers for their own students.
          const student = await studentsRepository.findById(
            db,
            auth.householdId,
            parsed.data.student_id,
          )
          if (!student) return new Response(null, { status: 404 })

          const result = await generatePaper(db, parsed.data)
          return Response.json(result, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
