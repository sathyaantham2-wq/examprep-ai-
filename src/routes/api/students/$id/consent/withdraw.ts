import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../../lib/session'
import { getSharedDb } from '../../../../../db/connection'
import {
  studentsRepository,
  consentsRepository,
  auditLogRepository,
} from '../../../../../db/repositories'
import { wrapRouteHandlers } from '../../../../../lib/error-log'

// F095: "withdrawal supported". Not in tab05's listed 38 routes (the sheet has no consent
// endpoints at all) -- added as the smallest reasonable path under the existing
// /api/students/:id resource, since the AC explicitly requires it and there is nowhere else for
// it to live. Withdrawing consent does not delete or lock the student profile (that's F098's
// export/delete scope); it only records that consent is no longer active, which
// POST /api/papers/generate now checks before creating new content for this student.
export const Route = createFileRoute('/api/students/$id/consent/withdraw')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const student = await studentsRepository.findById(
          db,
          auth.householdId,
          params.id,
        )
        if (!student) return new Response(null, { status: 404 })

        const active = await consentsRepository.findActiveForStudent(
          db,
          student.id,
        )
        if (!active) {
          return Response.json(
            { error: 'No active consent to withdraw for this student' },
            { status: 409 },
          )
        }

        const withdrawn = await consentsRepository.withdraw(
          db,
          auth.householdId,
          active.id,
        )

        // F099: consent withdrawal is exactly the kind of sensitive, privacy-relevant write
        // the audit trail exists for.
        await auditLogRepository.insert(db, {
          household_id: auth.householdId,
          actor_user_id: auth.id,
          action: 'consent.withdrawn',
          entity: 'consents',
          entity_id: active.id,
          before: JSON.stringify(active),
          after: JSON.stringify(withdrawn),
        })

        return Response.json(withdrawn)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/students/$id/consent/withdraw', ['POST'])
