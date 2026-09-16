import { createFileRoute } from '@tanstack/react-router'
import { getSharedDb } from '../../../db/connection'
import { generateOrGetTodayNudge } from '../../../lib/daily-nudge'
import { buildDailyNudgeEmail, notifyHouseholdParents } from '../../../lib/email'
import { env } from '../../../lib/env'
import { wrapRouteHandlers } from '../../../lib/error-log'

/**
 * F082: "delivered once daily." Scheduled (vercel.json) for 01:30 UTC = ~7:00am IST -- this
 * app's whole userbase is one Indian family (CLAUDE.md launch scope), so a fixed IST-morning
 * time is a documented default, not a real per-timezone scheduler. Same Vercel Cron +
 * CRON_SECRET pattern as /api/cron/weekly-summary (see that route for why an unauthenticated
 * cron route would be a real problem, not just a formality). Generates (or finds) today's nudge
 * for every student and
 * emails it to their household's parent(s) -- generateOrGetTodayNudge is idempotent per
 * (student_id, date), so a second run the same day (a manual retry, say) re-sends the same
 * action rather than a different one or an error.
 */
export const Route = createFileRoute('/api/cron/daily-nudge')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!env.CRON_SECRET) {
          return new Response('CRON_SECRET is not configured', { status: 500 })
        }
        if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
          return new Response(null, { status: 401 })
        }

        const db = getSharedDb()
        const students = await db
          .selectFrom('students')
          .select(['id', 'name', 'household_id'])
          .execute()

        for (const student of students) {
          const nudge = await generateOrGetTodayNudge(db, student.id)
          await notifyHouseholdParents(db, {
            householdId: student.household_id,
            template: 'daily_nudge',
            content: buildDailyNudgeEmail({
              studentName: student.name,
              actionText: nudge.action_text,
              nudgeUrl: `${env.BETTER_AUTH_URL}/home`,
            }),
          })
        }

        return Response.json({ students_processed: students.length })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/cron/daily-nudge', ['GET'])
