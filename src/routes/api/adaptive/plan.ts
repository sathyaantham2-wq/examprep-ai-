import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getSharedDb } from '../../../db/connection'
import { resolveAdaptiveStudent } from '../../../lib/adaptive/access'
import { buildPaperPlan } from '../../../lib/adaptive/plan'
import { wrapRouteHandlers } from '../../../lib/error-log'

const querySchema = z.object({
  subject_id: z.string().uuid(),
  chapter_ids: z.string().optional(),
})

// The paper recommended for this student and subject: chapters, questions per concept, difficulty
// range, time and question types. The student can accept it or change the chapters.
export const Route = createFileRoute('/api/adaptive/plan')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const db = getSharedDb()
        const resolved = await resolveAdaptiveStudent(request, db)
        if (resolved instanceof Response) return resolved

        const url = new URL(request.url)
        const parsed = querySchema.safeParse({
          subject_id: url.searchParams.get('subject_id') ?? undefined,
          chapter_ids: url.searchParams.get('chapter_ids') ?? undefined,
        })
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }
        const chapterIds = parsed.data.chapter_ids
          ?.split(',')
          .map((id) => id.trim())
          .filter(Boolean)
        if (chapterIds?.some((id) => !z.string().uuid().safeParse(id).success)) {
          return Response.json({ error: 'chapter_ids must be uuids' }, { status: 400 })
        }

        const plan = await buildPaperPlan(db, {
          studentId: resolved.student.id,
          subjectId: parsed.data.subject_id,
          chapterIds,
        })
        if (!plan) {
          return Response.json(
            { error: 'no_content', message: 'Questions for this subject are not available yet.' },
            { status: 404 },
          )
        }
        return Response.json(plan)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/adaptive/plan', ['GET'])
