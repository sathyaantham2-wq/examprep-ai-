import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import {
  questionsRepository,
  questionOptionsRepository,
  questionStepMarksRepository,
} from '../../../db/repositories'

const updateQuestionSchema = z
  .object({
    text: z.string().min(1),
    answer: z.string().min(1),
    hint: z.string().min(1).nullable(),
    tags: z.array(z.string()),
    source_ref: z.string().min(1).nullable(),
    // F118: "can be retired without deleting historical results" -- retiring only flips this
    // column; every paper/attempt/evaluation that already used the question keeps referencing it
    // untouched (status isn't a FK target anywhere, so nothing cascades on the change).
    status: z.enum(['draft', 'approved', 'retired']),
    // F060: previously settable only via POST /api/questions or bulk import -- there was no way
    // to correct this on a question already in the bank without going around the API entirely.
    is_reversal_word: z.boolean(),
  })
  .partial()

export const Route = createFileRoute('/api/questions/$id')({
  server: {
    handlers: {
      // Admin-only full detail (unlike the student-facing attempt view, this legitimately
      // includes answer/is_correct — an admin reviewing a question IS the answer-key audience).
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const db = getSharedDb()
        const question = await questionsRepository.findById(db, params.id)
        if (!question) return new Response(null, { status: 404 })

        const [options, stepMarks] = await Promise.all([
          questionOptionsRepository.listByQuestion(db, params.id),
          questionStepMarksRepository.listByQuestion(db, params.id),
        ])
        return Response.json({ ...question, options, step_marks: stepMarks })
      },
      PATCH: async ({ request, params }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = updateQuestionSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const db = getSharedDb()
        const existing = await questionsRepository.findById(db, params.id)
        if (!existing) return new Response(null, { status: 404 })

        const updated = await questionsRepository.update(
          db,
          params.id,
          parsed.data,
        )
        return Response.json(updated)
      },
    },
  },
})
