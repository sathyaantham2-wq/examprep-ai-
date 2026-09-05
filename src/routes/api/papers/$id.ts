import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import {
  papersRepository,
  paperQuestionsRepository,
} from '../../../db/repositories'

// tab05 lists this route as Parent-only. Student self-access (with answers/keys stripped, per
// the hard rule that a student can never see an answer key) needs F112 — the student
// self-service login-linkage — which isn't built yet, so it isn't handled here either.
export const Route = createFileRoute('/api/papers/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const db = createDb()
        try {
          const paper = await papersRepository.findByIdForHousehold(
            db,
            auth.householdId,
            params.id,
          )
          if (!paper) return new Response(null, { status: 404 })

          const questions =
            await paperQuestionsRepository.listForPaperWithQuestions(
              db,
              paper.id,
            )
          return Response.json({ ...paper, questions })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
