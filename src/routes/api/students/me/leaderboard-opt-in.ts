import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import { studentsRepository } from '../../../../db/repositories'
import { generateNickname } from '../../../../lib/leaderboard'
import { wrapRouteHandlers } from '../../../../lib/error-log'

// F125 (second slice). Student-self only, deliberately -- the leaderboard only ever shows an
// opted-in student's own anonymous nickname and point total (never a real name, never another
// student's underlying data), the same posture already used for her own theme choice on
// /my-paper. She can turn it on/off and reroll her nickname any time; a parent can always see it
// through her own dashboard, same as everything else she does.
const bodySchema = z.object({
  opt_in: z.boolean().optional(),
  regenerate_nickname: z.boolean().optional(),
})

export const Route = createFileRoute('/api/students/me/leaderboard-opt-in')({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const student = await resolveEnabledStudent(getSharedDb(), auth.id)
        if (student instanceof Response) return student

        const parsed = bodySchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }
        const { opt_in, regenerate_nickname } = parsed.data

        const db = getSharedDb()
        const wantsNickname =
          regenerate_nickname === true || (opt_in === true && !student.leaderboard_nickname)

        const updated = await studentsRepository.update(db, student.household_id, student.id, {
          ...(opt_in !== undefined ? { leaderboard_opt_in: opt_in } : {}),
          ...(wantsNickname ? { leaderboard_nickname: generateNickname() } : {}),
        })

        return Response.json({
          opt_in: updated.leaderboard_opt_in,
          nickname: updated.leaderboard_nickname,
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/students/me/leaderboard-opt-in', ['PATCH'])
