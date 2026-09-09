import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { generatePaper } from '../../../lib/papers'
import { createDb } from '../../../db/connection'
import {
  studentsRepository,
  consentsRepository,
} from '../../../db/repositories'

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

// F113: chapter_id -> percentage, keyed dynamically since it depends on which chapters were
// picked. Same "must sum to 100" contract as weightingSchema above.
const chapterWeightingSchema = z
  .record(z.string().uuid(), z.number().min(0).max(100))
  .refine(
    (w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 0.01,
    { message: 'chapter_weighting_override must sum to 100' },
  )

const generateSchema = z
  .object({
    student_id: z.string().uuid(),
    blueprint_id: z.string().uuid(),
    chapter_ids: z.array(z.string().uuid()).min(1),
    theme: z.string().min(1).optional(),
    // F119: this is a ceiling on difficulty, never a filter on which concepts get picked.
    difficulty_ceiling: z.enum(DIFFICULTY_TIERS).optional(),
    weighting_override: weightingSchema.optional(),
    // F113: overrides the concept-count-proportional per-chapter marks split.
    chapter_weighting_override: chapterWeightingSchema.optional(),
    // F026: "generator excludes questions served within a configurable window" -- previously
    // only configurable by calling generatePaper() directly (as every test in this repo does),
    // never through the real route. Defaults to generatePaper()'s own 14-day default when
    // omitted.
    recent_usage_window_days: z.number().int().nonnegative().optional(),
  })
  .refine(
    (v) =>
      !v.chapter_weighting_override ||
      (new Set(Object.keys(v.chapter_weighting_override)).size ===
        v.chapter_ids.length &&
        v.chapter_ids.every((id) => id in v.chapter_weighting_override!)),
    {
      message:
        'chapter_weighting_override must have exactly one weight per chapter_id',
      path: ['chapter_weighting_override'],
    },
  )

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

          // F095: consent is required before generating any new content for this student. Not
          // "the student has no consent record" specifically -- some students predate this
          // feature or were created directly at the repository layer (fixtures/tests) -- but any
          // active-consent check has to treat "no row at all" the same as "withdrawn", since
          // both mean there is currently no valid consent on file.
          const activeConsent = await consentsRepository.findActiveForStudent(
            db,
            student.id,
          )
          if (!activeConsent) {
            return Response.json(
              {
                error:
                  'Parental consent for this student is missing or has been withdrawn -- generation is blocked until consent is given again',
              },
              { status: 403 },
            )
          }

          const result = await generatePaper(db, {
            ...parsed.data,
            recentUsageWindowDays: parsed.data.recent_usage_window_days,
          })
          return Response.json(result, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
