import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { createQuestion, questionInputSchema } from '../../lib/questions'
import { getSharedDb } from '../../db/connection'
import {
  questionsRepository,
  questionUsageRepository,
} from '../../db/repositories'
import { wrapRouteHandlers } from '../../lib/error-log'

const BLOOM_LEVELS = [
  'Remember',
  'Understand',
  'Apply',
  'Analyse',
  'Evaluate',
  'Create',
] as const
const DIFFICULTY_TIERS = ['Easy', 'Hard', 'Hardest'] as const
const QUESTION_TYPES = [
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'short_answer',
  'long_answer',
  'fill_blank',
  'diagram',
] as const
const QUESTION_STATUSES = ['approved', 'retired'] as const

export const Route = createFileRoute('/api/questions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const url = new URL(request.url)
        const params = url.searchParams
        const parsedFilters = z
          .object({
            concept: z.string().uuid().optional(),
            bloom: z.enum(BLOOM_LEVELS).optional(),
            difficulty: z.enum(DIFFICULTY_TIERS).optional(),
            type: z.enum(QUESTION_TYPES).optional(),
            status: z.enum(QUESTION_STATUSES).optional(),
            page: z.coerce.number().int().positive().optional(),
            pageSize: z.coerce.number().int().positive().max(100).optional(),
            // F026: "per student, last_served_at and times_served" -- opt-in, since usage is
            // meaningless without a specific student to ask about.
            student_id: z.string().uuid().optional(),
          })
          .safeParse(Object.fromEntries(params))
        if (!parsedFilters.success) {
          return Response.json(
            { error: parsedFilters.error.flatten() },
            { status: 400 },
          )
        }

        const {
          concept,
          bloom,
          difficulty,
          type,
          status,
          page = 1,
          pageSize = 20,
          student_id: studentId,
        } = parsedFilters.data

        const db = getSharedDb()
        const { items, total } = await questionsRepository.search(
          db,
          { concept_id: concept, bloom, difficulty, type, status },
          pageSize,
          (page - 1) * pageSize,
        )

        if (!studentId) {
          return Response.json({ items, total, page, pageSize })
        }

        const usageByQuestion = await questionUsageRepository.summaryForStudent(
          db,
          studentId,
          items.map((item) => item.id),
        )
        const itemsWithUsage = items.map((item) => ({
          ...item,
          usage: usageByQuestion.get(item.id) ?? null,
        }))
        return Response.json({ items: itemsWithUsage, total, page, pageSize })
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = questionInputSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const question = await createQuestion(db, {
          ...parsed.data,
          created_by: auth.id,
        })
        return Response.json(question, { status: 201 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/questions', ['GET', 'POST'])
