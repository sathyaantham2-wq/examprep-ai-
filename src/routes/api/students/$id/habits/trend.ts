import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../../lib/session'
import { getSharedDb } from '../../../../../db/connection'
import {
  studentsRepository,
  habitObservationsRepository,
} from '../../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../../lib/error-log'

// F058: "a trend line." Not in tab05's listed routes -- added under the existing
// /api/students/:id resource. Groups every confirmed evaluation's habit ratings by habit, oldest
// first, so a client can plot one line per habit rather than one point per paper.
export const Route = createFileRoute('/api/students/$id/habits/trend')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'teacher', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          params.id,
        )
        if (!student) return new Response(null, { status: 404 })

        const rows = await habitObservationsRepository.trendForStudent(
          db,
          student.id,
        )

        const byHabit = new Map<
          string,
          {
            habit_id: string
            habit_code: string
            habit_name: string
            observations: Array<{ rating: string; confirmed_at: Date }>
          }
        >()
        for (const row of rows) {
          const existing = byHabit.get(row.habit_id) ?? {
            habit_id: row.habit_id,
            habit_code: row.habit_code,
            habit_name: row.habit_name,
            observations: [],
          }
          existing.observations.push({
            rating: row.rating,
            confirmed_at: row.confirmed_at!,
          })
          byHabit.set(row.habit_id, existing)
        }

        return Response.json([...byHabit.values()])
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/students/$id/habits/trend', ['GET'])
