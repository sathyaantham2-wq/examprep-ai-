import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { subjectsRepository } from '../../../db/repositories'
import { wrapRouteHandlers } from '../../../lib/error-log'

const createSchema = z.object({
  board: z.string().trim().min(1),
  class: z.number().int().min(0).max(12),
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  language: z.string().trim().min(1).optional(),
})

// Admin-only subject list (including inactive ones) and creation. A subject is switched off with
// PATCH /api/admin/subjects/:id, never deleted: students' history points at it.
export const Route = createFileRoute('/api/admin/subjects')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const subjects = await getSharedDb()
          .selectFrom('subjects as s')
          .select([
            's.id',
            's.board',
            's.class',
            's.name',
            's.code',
            's.language',
            's.is_active',
            (eb) =>
              eb
                .selectFrom('chapters as ch')
                .select((c) => c.fn.countAll<string>().as('n'))
                .whereRef('ch.subject_id', '=', 's.id')
                .as('chapter_count'),
          ])
          .where('s.code', 'not like', '%-SEED')
          .orderBy('s.board')
          .orderBy('s.class')
          .orderBy('s.name')
          .execute()
        return Response.json(
          subjects.map((s) => ({ ...s, chapter_count: Number(s.chapter_count ?? 0) })),
        )
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const parsed = createSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }
        const db = getSharedDb()
        const clash = await db
          .selectFrom('subjects')
          .select('id')
          .where('board', '=', parsed.data.board)
          .where('class', '=', parsed.data.class)
          .where((eb) =>
            eb.or([
              eb('code', '=', parsed.data.code),
              eb(eb.fn('lower', ['name']), '=', parsed.data.name.toLowerCase()),
            ]),
          )
          .executeTakeFirst()
        if (clash) {
          return Response.json(
            { error: 'A subject with that name or code already exists for this class' },
            { status: 409 },
          )
        }
        const created = await subjectsRepository.insert(db, {
          board: parsed.data.board,
          class: parsed.data.class,
          name: parsed.data.name,
          code: parsed.data.code,
          language: parsed.data.language ?? 'English',
          is_active: true,
        })
        return Response.json(created, { status: 201 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/admin/subjects', ['GET', 'POST'])
