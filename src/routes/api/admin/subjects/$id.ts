import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { subjectsRepository } from '../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    language: z.string().trim().min(1),
    is_active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })

export const Route = createFileRoute('/api/admin/subjects/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const parsed = patchSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }
        const db = getSharedDb()
        const existing = await subjectsRepository.findById(db, params.id)
        if (!existing) return new Response(null, { status: 404 })
        const updated = await subjectsRepository.update(db, params.id, parsed.data)
        return Response.json(updated)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/admin/subjects/$id', ['PATCH'])
