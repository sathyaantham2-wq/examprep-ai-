import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../../lib/session'
import { resolveEnabledStudent } from '../../../../lib/access'
import { getSharedDb } from '../../../../db/connection'
import {
  attemptAnswersRepository,
  attemptsRepository,
  paperQuestionsRepository,
} from '../../../../db/repositories'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BASE64_CHARS,
  transcribeHandwriting,
} from '../../../../lib/ai-transcription'
import { isAiConfigured } from '../../../../lib/ai-provider'
import { isObjectiveType } from '../../../../lib/scoring'
import {
  AiCapReachedError,
  StudentSpendCapReachedError,
  enforceStudentSpendBudget,
} from '../../../../lib/ai-metering'
import { wrapRouteHandlers } from '../../../../lib/error-log'

const bodySchema = z.object({
  paper_question_id: z.string().uuid(),
  media_type: z.enum(ALLOWED_IMAGE_TYPES),
  image_base64: z.string().min(100).max(MAX_IMAGE_BASE64_CHARS).regex(/^[A-Za-z0-9+/=]+$/),
})

/**
 * POST /api/attempts/:id/answer-image -- the student photographs a handwritten answer to one
 * written question. A vision model reads it, and the text is saved as her answer (source 'ocr')
 * and returned so she can check and correct it before submitting. The photo itself is not stored.
 */
export const Route = createFileRoute('/api/attempts/$id/answer-image')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth

        const parsed = bodySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return Response.json(
            { error: 'invalid_image', message: 'Send a JPEG, PNG or WebP photo under 3 MB.' },
            { status: 400 },
          )
        }
        if (!isAiConfigured()) {
          return Response.json(
            {
              error: 'ai_unavailable',
              message: 'Reading photos is not switched on yet. Type your answer instead.',
            },
            { status: 503 },
          )
        }

        const db = getSharedDb()
        const student = await resolveEnabledStudent(db, auth.id)
        if (student instanceof Response) return student

        const attempt = await attemptsRepository.findById(db, student.id, params.id)
        if (!attempt) return new Response(null, { status: 404 })
        if (attempt.status !== 'in_progress') {
          return Response.json({ error: 'This attempt is already closed' }, { status: 409 })
        }
        const slot = await paperQuestionsRepository.findById(db, parsed.data.paper_question_id)
        if (!slot || slot.paper_id !== attempt.paper_id) {
          return Response.json({ error: 'That question is not part of this attempt' }, { status: 400 })
        }
        const slots = await paperQuestionsRepository.listForPaperWithQuestions(db, attempt.paper_id)
        const question = slots.find((q) => q.id === slot.id)
        if (!question || isObjectiveType(question.type)) {
          return Response.json({ error: 'Photos can only be used for written answers' }, { status: 400 })
        }

        let result
        try {
          await enforceStudentSpendBudget(db, { studentId: student.id })
          result = await transcribeHandwriting(db, {
            imageBase64: parsed.data.image_base64,
            mediaType: parsed.data.media_type,
            questionText: question.text,
            householdId: student.household_id,
            studentId: student.id,
          })
        } catch (error) {
          if (error instanceof AiCapReachedError || error instanceof StudentSpendCapReachedError) {
            return Response.json(
              {
                error: 'ai_limit',
                message: 'The photo reader has reached its limit for now. Type your answer instead.',
              },
              { status: 429 },
            )
          }
          return Response.json(
            {
              error: 'ai_failed',
              message: 'Could not read the photo right now. Try again or type your answer.',
            },
            { status: 502 },
          )
        }
        if (!result) {
          return Response.json(
            {
              error: 'unreadable',
              message: 'The writing could not be read. Try a clearer, brighter photo, or type your answer.',
            },
            { status: 422 },
          )
        }

        await attemptAnswersRepository.upsert(db, {
          attempt_id: attempt.id,
          paper_question_id: slot.id,
          response_text: result.text,
          source: 'ocr',
          ocr_confidence: result.confidence,
        })
        return Response.json({ text: result.text, confidence: result.confidence })
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/attempts/$id/answer-image', ['POST'])
