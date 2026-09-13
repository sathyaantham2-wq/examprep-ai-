import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { resolveEnabledStudent } from '../../../lib/access'
import { generatePaper } from '../../../lib/papers'
import { getSharedDb } from '../../../db/connection'
import {
  studentsRepository,
  consentsRepository,
  generationEventsRepository,
} from '../../../db/repositories'
import { PAPER_THEMES } from '../../../lib/pdf/themes'
import {
  StudentSpendCapReachedError,
  enforceStudentSpendBudget,
} from '../../../lib/ai-metering'
import { logProductEvent } from '../../../lib/product-events'

// F112: "Student role may generate ... papers within a daily quota." Not a number the plan
// specifies -- a documented default, the same kind RETEST_LADDER_DAYS (src/lib/mastery.ts) and
// MARK_TO_POINT_MIN_CHARS (src/lib/habit-drills.ts) already are elsewhere in this codebase.
export const STUDENT_DAILY_GENERATION_QUOTA = 3

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
    // F112: required for a parent/admin caller (which student?), ignored for a student caller
    // (always themselves -- never trust a body-supplied id for who a student generates as, the
    // same reasoning POST /api/attempts already applies).
    student_id: z.string().uuid().optional(),
    blueprint_id: z.string().uuid(),
    chapter_ids: z.array(z.string().uuid()).min(1),
    // F034: "selectable at generation" -- the moment this actually gets validated; the PDF
    // route's own ?theme= override is deliberately more lenient (falls back rather than 400s,
    // since it's just a re-print convenience, not the generation record).
    theme: z.enum(PAPER_THEMES).optional(),
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
        const auth = await requireRole(request, 'student', 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = generateSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        // F112: a student always generates as themselves (F010's access_enabled gate applies
        // here too); a parent/admin must name student_id and it is checked against their own
        // household -- same shape GET /api/remediation and GET /api/habit-drills already use.
        let student
        if (auth.role === 'student') {
          student = await resolveEnabledStudent(db, auth.id)
          if (student instanceof Response) return student
        } else {
          if (!parsed.data.student_id) {
            return Response.json(
              { error: 'student_id is required' },
              { status: 400 },
            )
          }
          const found = await studentsRepository.findById(
            db,
            auth.householdId,
            parsed.data.student_id,
          )
          if (!found) return new Response(null, { status: 404 })
          student = found
        }

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

        if (auth.role === 'student') {
          const usedToday =
            await generationEventsRepository.countTodayByStudentAndTrigger(
              db,
              student.id,
              'student',
            )
          if (usedToday >= STUDENT_DAILY_GENERATION_QUOTA) {
            return Response.json(
              {
                error: 'daily_quota_exceeded',
                message: `You've reached today's limit of ${STUDENT_DAILY_GENERATION_QUOTA} papers -- try again tomorrow.`,
              },
              { status: 429 },
            )
          }

          // F121: a second, independent ceiling alongside F112's raw call-count quota above --
          // this one is INR spend (generation + this student's own grading, F091/ai_jobs.cost_inr),
          // so a handful of unusually large/expensive calls can still be capped even while under
          // the daily paper-count quota.
          try {
            await enforceStudentSpendBudget(db, { studentId: student.id })
          } catch (err) {
            if (err instanceof StudentSpendCapReachedError) {
              return Response.json(
                { error: 'spend_cap_exceeded', message: err.message },
                { status: 429 },
              )
            }
            throw err
          }
        }

        const result = await generatePaper(db, {
          ...parsed.data,
          student_id: student.id,
          recentUsageWindowDays: parsed.data.recent_usage_window_days,
        })

        if (auth.role === 'student') {
          await generationEventsRepository.insert(db, {
            student_id: student.id,
            triggered_by: 'student',
          })
        }

        await logProductEvent(db, {
          eventType: 'paper_generated',
          householdId: student.household_id,
          studentId: student.id,
        })

        return Response.json(result, { status: 201 })
      },
    },
  },
})
