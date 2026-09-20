import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../lib/session'
import { getSharedDb } from '../../db/connection'
import { createInvite, listForGuardian } from '../../lib/guardian-links'
import {
  buildGuardianInviteEmail,
  sendTransactionalEmail,
} from '../../lib/email'
import { env } from '../../lib/env'
import { wrapRouteHandlers } from '../../lib/error-log'

const createSchema = z.object({
  student_email: z.string().email(),
  // The guardian confirms they agree to the privacy notice for this student's data. It is
  // recorded as a consent (F095) only once the student approves.
  consent: z.literal(true),
})

// A parent or teacher follows a student by her email. The student approves from her own login.
export const Route = createFileRoute('/api/guardian-invites')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'teacher', 'admin')
        if (auth instanceof Response) return auth
        const rows = await listForGuardian(getSharedDb(), auth.householdId)
        return Response.json(rows)
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'teacher', 'admin')
        if (auth instanceof Response) return auth

        const parsed = createSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const result = await createInvite(
          db,
          { userId: auth.id, householdId: auth.householdId },
          parsed.data.student_email,
          parsed.data.consent,
        )
        if (!result.ok) {
          const isSelf = result.error === 'self_invite'
          return Response.json(
            {
              error: isSelf
                ? 'That is your own email address.'
                : 'You are already following this student.',
            },
            { status: isSelf ? 400 : 409 },
          )
        }

        if (result.value.created) {
          // Best effort, and never a hint about whether an account exists: the response below is
          // identical either way. Delivery follows the app's normal email setup and is recorded
          // as skipped when no mail service is configured.
          const target = await db
            .selectFrom('users')
            .select(['id'])
            .where('email', '=', parsed.data.student_email.trim().toLowerCase())
            .where('role', '=', 'student')
            .executeTakeFirst()
          const guardian = await db
            .selectFrom('users')
            .select(['name', 'role'])
            .where('id', '=', auth.id)
            .executeTakeFirst()
          if (target && guardian) {
            await sendTransactionalEmail(db, {
              userId: target.id,
              template: 'guardian_invite',
              content: buildGuardianInviteEmail({
                guardianName: guardian.name,
                guardianRole: guardian.role,
                appUrl: env.BETTER_AUTH_URL,
              }),
            })
          }
        }

        return Response.json({ status: 'pending' }, { status: 201 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/guardian-invites', ['GET', 'POST'])
