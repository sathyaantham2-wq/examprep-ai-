import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { studentsRepository } from '../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const createLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

/**
 * Bridges F007 (role model)/F008 (household & multi-student profiles)/F010 (parent-controlled
 * student access) -- none of those tickets actually specify how a student's login gets created in
 * the first place. Every fixture in this repo has always inserted one directly into users/accounts
 * (see createStudentSession in db/test-helpers.ts) because no real path existed; this is that path.
 * New scope, not literally one existing ticket's AC -- see tab03 notes on F007/F008/F010.
 */
export const Route = createFileRoute('/api/students/$id/login')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = createLoginSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          params.id,
        )
        if (!student) return new Response(null, { status: 404 })
        if (student.user_id) {
          return Response.json(
            { error: 'This student already has a login' },
            { status: 409 },
          )
        }

        const { hashPassword } = await import('better-auth/crypto')
        const hash = await hashPassword(parsed.data.password)

        try {
          const user = await db.transaction().execute(async (trx) => {
            const created = await trx
              .insertInto('users')
              .values({
                household_id: auth.householdId,
                email: parsed.data.email,
                name: student.name,
                role: 'student',
                email_verified: true,
              })
              .returningAll()
              .executeTakeFirstOrThrow()

            await trx
              .insertInto('accounts')
              .values({
                issuer: 'local:credential',
                account_id: created.id,
                provider_id: 'credential',
                user_id: created.id,
                password: hash,
              })
              .execute()

            await trx
              .updateTable('students')
              .set({ user_id: created.id })
              .where('id', '=', student.id)
              .execute()

            return created
          })
          return Response.json(
            { id: user.id, email: user.email, name: user.name },
            { status: 201 },
          )
        } catch (err) {
          if (err instanceof Error && /unique/i.test(err.message)) {
            return Response.json(
              { error: 'That email is already in use' },
              { status: 409 },
            )
          }
          throw err
        }
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/students/$id/login', ['POST'])
