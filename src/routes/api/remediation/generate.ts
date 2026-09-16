import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { studentsRepository } from '../../../db/repositories'
import { buildRemediationPack } from '../../../lib/remediation'
import { logProductEvent } from '../../../lib/product-events'
import { wrapRouteHandlers } from '../../../lib/error-log'

const requestSchema = z.object({
  student_id: z.string().uuid(),
  concept_id: z.string().uuid(),
})

const REASON_MESSAGES: Record<string, { status: number; message: string }> = {
  concept_not_found: { status: 404, message: 'Concept not found' },
  not_priority: {
    status: 422,
    message: 'This concept is not currently flagged Priority for this student',
  },
  no_questions_available: {
    status: 422,
    message: 'No approved objective questions exist for this concept yet',
  },
}

// F066 (tab05): POST /api/remediation/generate, Parent, {student_id, concept_id} -> a remediation
// task with refresher, examples, and 3 practice questions.
export const Route = createFileRoute('/api/remediation/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = requestSchema.safeParse(await request.json())
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
          parsed.data.student_id,
        )
        if (!student) return new Response(null, { status: 404 })

        const result = await buildRemediationPack(db, {
          studentId: student.id,
          conceptId: parsed.data.concept_id,
        })

        if (!result.ok) {
          const { status, message } = REASON_MESSAGES[result.reason]
          return Response.json({ error: message }, { status })
        }

        await logProductEvent(db, {
          eventType: 'remediation_started',
          householdId: auth.householdId,
          studentId: student.id,
        })

        return Response.json(result, { status: 201 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/remediation/generate', ['POST'])
