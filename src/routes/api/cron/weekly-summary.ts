import { createFileRoute } from '@tanstack/react-router'
import { getSharedDb } from '../../../db/connection'
import { buildWeeklySummary } from '../../../lib/weekly-summary'
import { mostRecentMonday } from '../../../lib/study-plan'
import { buildWeeklySummaryEmail, notifyHouseholdParents } from '../../../lib/email'
import { env } from '../../../lib/env'

/**
 * F080/F074: the "weekly summary" email named in F080's AC. Triggered by Vercel Cron (see
 * vercel.json, Sunday evenings UTC -- reporting the week that's just ending, Monday through
 * today, matches the AC's "auto every 7 active days" intent closely enough without needing a
 * per-student schedule this app has no other use for). Vercel signs every cron invocation with
 * `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET configured, this route refuses
 * outright rather than silently running unauthenticated (an unauthenticated version would let
 * anyone who finds this URL trigger an email blast to every household on demand).
 */
export const Route = createFileRoute('/api/cron/weekly-summary')({
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
        const weekStart = mostRecentMonday(new Date())
        const students = await db
          .selectFrom('students')
          .select(['id', 'name', 'household_id'])
          .execute()

        for (const student of students) {
          const summary = await buildWeeklySummary(db, student.id, weekStart)
          await notifyHouseholdParents(db, {
            householdId: student.household_id,
            template: 'weekly_summary',
            content: buildWeeklySummaryEmail({
              studentName: student.name,
              summary,
              summaryUrl: `${env.BETTER_AUTH_URL}/home`,
            }),
          })
        }

        return Response.json({ students_processed: students.length })
      },
    },
  },
})
