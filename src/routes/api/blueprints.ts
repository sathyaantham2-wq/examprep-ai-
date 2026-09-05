import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole, requireUser } from '../../lib/session'
import { createDb } from '../../db/connection'
import { blueprintsRepository } from '../../db/repositories'

const BLOOM_LEVELS = [
  'Remember',
  'Understand',
  'Apply',
  'Analyse',
  'Evaluate',
  'Create',
] as const

const sectionSchema = z.object({
  name: z.string().min(1),
  marks_per_question: z.number().int().positive(),
  count: z.number().int().positive(),
  bloom_allowed: z.array(z.enum(BLOOM_LEVELS)).min(1),
})

const createBlueprintSchema = z
  .object({
    subject_id: z.string().uuid(),
    board: z.string().min(1),
    class: z.number().int().min(1).max(12),
    name: z.string().min(1),
    duration_min: z.number().int().positive(),
    sections: z.array(sectionSchema).min(1),
    bloom_targets: z.record(z.enum(BLOOM_LEVELS), z.number().min(0).max(100)),
    choice_rules: z.array(z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    const bloomTotal = Object.values(data.bloom_targets).reduce(
      (sum, v) => sum + v,
      0,
    )
    if (Math.abs(bloomTotal - 100) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['bloom_targets'],
        message: `bloom_targets must sum to 100, got ${bloomTotal}`,
      })
    }
  })

export const Route = createFileRoute('/api/blueprints')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request)
        if (auth instanceof Response) return auth

        const subjectId = new URL(request.url).searchParams.get('subject_id')
        if (!subjectId) {
          return Response.json(
            { error: 'subject_id query param is required' },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const blueprints = await blueprintsRepository.listBySubject(
            db,
            subjectId,
          )
          return Response.json(blueprints)
        } finally {
          await db.destroy()
        }
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = createBlueprintSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const totalMarks = parsed.data.sections.reduce(
          (sum, section) => sum + section.count * section.marks_per_question,
          0,
        )

        const db = createDb()
        try {
          const blueprint = await blueprintsRepository.insert(db, {
            subject_id: parsed.data.subject_id,
            board: parsed.data.board,
            class: parsed.data.class,
            name: parsed.data.name,
            total_marks: totalMarks,
            duration_min: parsed.data.duration_min,
            sections: JSON.stringify(parsed.data.sections),
            bloom_targets: JSON.stringify(parsed.data.bloom_targets),
            choice_rules: parsed.data.choice_rules
              ? JSON.stringify(parsed.data.choice_rules)
              : undefined,
          })
          return Response.json(blueprint, { status: 201 })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
