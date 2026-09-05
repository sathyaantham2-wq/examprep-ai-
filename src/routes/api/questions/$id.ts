import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { questionsRepository } from '../../../db/repositories'

const updateQuestionSchema = z
  .object({
    text: z.string().min(1),
    answer: z.string().min(1),
    hint: z.string().min(1).nullable(),
    tags: z.array(z.string()),
    source_ref: z.string().min(1).nullable(),
  })
  .partial()

export const Route = createFileRoute('/api/questions/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = updateQuestionSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const existing = await questionsRepository.findById(db, params.id)
          if (!existing) return new Response(null, { status: 404 })

          const updated = await questionsRepository.update(
            db,
            params.id,
            parsed.data,
          )
          return Response.json(updated)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
