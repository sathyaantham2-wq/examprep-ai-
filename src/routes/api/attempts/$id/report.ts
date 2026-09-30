import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import { attemptsRepository } from '../../../../db/repositories'
import {
  REPORT_COMMENT_MAX,
  REPORT_REASONS,
  createQuestionReport,
  listReportedForAttempt,
} from '../../../../lib/question-reports'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const bodySchema = z.object({
  paper_question_id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  comment: z.string().max(REPORT_COMMENT_MAX * 2),
})

const STATUS = {
  comment_length: 400,
  question_not_found: 404,
  already_reported: 409,
} as const

/**
 * F129: GET/POST /api/attempts/:id/report -- the student's "Report a problem" on one question of
 * her own attempt (during the attempt or after marking). GET lists which questions she has
 * already reported. Student-only, own attempt only; a report never changes a mark.
 */
export const Route = createFileRoute('/api/attempts/$id/report')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student
        const attempt = await attemptsRepository.findById(
          db,
          student.id,
          params.id,
        )
        if (!attempt) return new Response(null, { status: 404 })
        return Response.json({
          reported: await listReportedForAttempt(db, attempt.id),
        })
      },
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const parsed = bodySchema.safeParse(
          await request.json().catch(() => null),
        )
        if (!parsed.success) {
          return Response.json({ error: 'invalid_body' }, { status: 400 })
        }
        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student
        const attempt = await attemptsRepository.findById(
          db,
          student.id,
          params.id,
        )
        if (!attempt) return new Response(null, { status: 404 })
        const result = await createQuestionReport(db, {
          attempt,
          student,
          paperQuestionId: parsed.data.paper_question_id,
          reason: parsed.data.reason,
          comment: parsed.data.comment,
        })
        if (!result.ok) {
          return Response.json(
            { error: result.error },
            { status: STATUS[result.error] },
          )
        }
        return Response.json({ id: result.id }, { status: 201 })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/report', ['GET', 'POST'])
