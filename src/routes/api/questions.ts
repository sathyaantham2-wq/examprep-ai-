import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { createQuestion, questionInputSchema } from '../../lib/questions'
import { createDb } from '../../db/connection'
import { questionsRepository } from '../../db/repositories'

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
const QUESTION_STATUSES = ['draft', 'approved', 'retired'] as const

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
        } = parsedFilters.data

        const db = createDb()
        try {
          const { items, total } = await questionsRepository.search(
            db,
            { concept_id: concept, bloom, difficulty, type, status },
            pageSize,
            (page - 1) * pageSize,
          )
          return Response.json({ items, total, page, pageSize })
        } finally {
          await db.destroy()
        }
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

        const db = createDb()
        try {
          const question = await createQuestion(db, {
            ...parsed.data,
            created_by: auth.id,
          })
          return Response.json(question, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
