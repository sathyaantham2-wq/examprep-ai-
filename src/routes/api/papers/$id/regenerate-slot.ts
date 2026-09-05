import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { createDb } from '../../../../db/connection'
import {
  papersRepository,
  paperQuestionsRepository,
  questionsRepository,
  questionUsageRepository,
} from '../../../../db/repositories'

const regenerateSlotSchema = z.object({
  paper_question_id: z.string().uuid(),
})

// F031: swap one slot without touching the rest of the paper. Matches the replacement to the
// same concept, Bloom level, and marks as the slot it's replacing, so the paper's coverage and
// weighting stay intact — only the specific question instance changes.
export const Route = createFileRoute('/api/papers/$id/regenerate-slot')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const parsed = regenerateSlotSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const paper = await papersRepository.findByIdForHousehold(
            db,
            auth.householdId,
            params.id,
          )
          if (!paper) return new Response(null, { status: 404 })

          const slot = await paperQuestionsRepository.findById(
            db,
            parsed.data.paper_question_id,
          )
          if (!slot || slot.paper_id !== paper.id)
            return new Response(null, { status: 404 })

          const currentQuestion = await questionsRepository.findById(
            db,
            slot.question_id,
          )
          if (!currentQuestion) return new Response(null, { status: 404 })

          const paperQuestions =
            await paperQuestionsRepository.listForPaperWithQuestions(
              db,
              paper.id,
            )
          const excludeQuestionIds = paperQuestions.map((pq) => pq.question_id)

          const eligible = await questionsRepository.findEligibleForSlot(
            db,
            {
              conceptIds: [currentQuestion.concept_id],
              bloomAllowed: [currentQuestion.bloom],
              difficultiesAllowed: ['Easy', 'Hard', 'Hardest'],
              marks: slot.marks,
              excludeQuestionIds,
            },
            1,
          )
          const replacement = eligible.at(0)
          if (!replacement) {
            return Response.json(
              { error: 'No alternative question available for this slot' },
              { status: 409 },
            )
          }

          const updatedSlot = await paperQuestionsRepository.update(
            db,
            slot.id,
            {
              question_id: replacement.id,
            },
          )
          await questionUsageRepository.insert(db, {
            student_id: paper.student_id,
            question_id: replacement.id,
            paper_id: paper.id,
          })

          return Response.json({ ...updatedSlot, question: replacement })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})
