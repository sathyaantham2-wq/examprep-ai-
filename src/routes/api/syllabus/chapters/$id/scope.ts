import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole, requireUser } from '../../../../../lib/session'
import { getSharedDb } from '../../../../../db/connection'
import { chapterScopeRepository } from '../../../../../db/repositories'

const createScopeSchema = z.object({
  kind: z.enum(['IN', 'OUT']),
  items: z
    .array(
      z.object({
        item_text: z.string().min(1),
        page_ref: z.string().min(1).optional(),
      }),
    )
    .min(1),
})

export const Route = createFileRoute('/api/syllabus/chapters/$id/scope')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireUser(request)
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const items = await chapterScopeRepository.listByChapter(db, params.id)
        return Response.json({
          in: items.filter((item) => item.kind === 'IN'),
          out: items.filter((item) => item.kind === 'OUT'),
        })
      },
      // The generator refuses concepts outside the IN list (F016) — this is the only way
      // that list gets written, and it's admin-only on purpose.
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = createScopeSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const created = await chapterScopeRepository.insertMany(
          db,
          parsed.data.items.map((item) => ({
            chapter_id: params.id,
            kind: parsed.data.kind,
            item_text: item.item_text,
            page_ref: item.page_ref,
          })),
        )
        return Response.json(created, { status: 201 })
      },
    },
  },
})
