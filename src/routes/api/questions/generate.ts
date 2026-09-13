import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireRole } from '../../../lib/session'
import { getSharedDb } from '../../../db/connection'
import { createQuestion } from '../../../lib/questions'
import {
  generateQuestions,
  isAiQuestionGenerationConfigured,
} from '../../../lib/ai-question-generation'
import { AiCapReachedError } from '../../../lib/ai-metering'
import {
  chapterScopeRepository,
  conceptsRepository,
  questionsRepository,
} from '../../../db/repositories'

const BLOOM_LEVELS = [
  'Remember',
  'Understand',
  'Apply',
  'Analyse',
  'Evaluate',
  'Create',
] as const
const DIFFICULTY_TIERS = ['Easy', 'Hard', 'Hardest'] as const
const QUESTION_TYPES = [
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'short_answer',
  'long_answer',
  'fill_blank',
  'diagram',
] as const

const requestSchema = z.object({
  concept_id: z.string().uuid(),
  count: z.number().int().positive().max(20),
  bloom: z.enum(BLOOM_LEVELS),
  difficulty: z.enum(DIFFICULTY_TIERS),
  type: z.enum(QUESTION_TYPES).default('mcq'),
  marks: z.number().int().positive().default(1),
})

/**
 * F025 / AI-01 (tab07): POST /api/questions/generate per tab05's exact route contract. Admin
 * triggers N questions for one concept at a fixed Bloom/difficulty; accepted candidates are
 * written as Draft (origin='ai_generated' forces this in createQuestion, regardless of F117's
 * Tier A auto-approve) so "only approved questions enter papers" still holds for AI output.
 *
 * Fallback when AI isn't configured (tab07): "admin writes the question manually; queue stays
 * draft" — reported as a 200 with generated:[] and ai_configured:false, not an error, since this
 * is an expected, documented mode rather than a failure.
 */
export const Route = createFileRoute('/api/questions/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        const parsed = requestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          )
        }
        const input = parsed.data

        const db = getSharedDb()
        const concept = await conceptsRepository.findById(db, input.concept_id)
        if (!concept) {
          return Response.json({ error: 'Concept not found' }, { status: 404 })
        }

        const scope = await chapterScopeRepository.listByChapter(
          db,
          concept.chapter_id,
        )
        if (scope.filter((s) => s.kind === 'IN').length === 0) {
          return Response.json(
            {
              error:
                'This chapter has no IN-scope record. Author chapter scope before generating questions.',
            },
            { status: 422 },
          )
        }

        if (!isAiQuestionGenerationConfigured()) {
          return Response.json({
            generated: [],
            rejected: [],
            ai_configured: false,
            message:
              'No AI provider is configured. Admin writes the question manually; the review queue stays Draft-only.',
          })
        }

        const { items: exemplarQuestions } = await questionsRepository.search(
          db,
          {
            concept_id: input.concept_id,
            bloom: input.bloom,
            difficulty: input.difficulty,
            status: 'approved',
          },
          3,
          0,
        )

        // F092: a daily cap hit is reported distinctly from "AI not configured" -- the admin
        // needs to know to come back tomorrow, not to go check ANTHROPIC_API_KEY.
        let result: Awaited<ReturnType<typeof generateQuestions>> = null
        try {
          result = await generateQuestions(db, {
            conceptName: concept.name,
            conceptIdea: concept.idea,
            conceptRule: concept.rule,
            conceptExample: concept.example,
            scope,
            bloom: input.bloom,
            difficulty: input.difficulty,
            marks: input.marks,
            type: input.type,
            count: input.count,
            exemplars: exemplarQuestions.map((q) => ({
              text: q.text,
              answer: q.answer,
            })),
            householdId: null,
            studentId: null,
          })
        } catch (err) {
          if (err instanceof AiCapReachedError) {
            return Response.json({
              generated: [],
              rejected: [],
              ai_configured: true,
              capped: true,
              message: err.message,
            })
          }
          throw err
        }

        if (!result) {
          return Response.json({
            generated: [],
            rejected: [],
            ai_configured: false,
            message:
              'No AI provider is configured. Admin writes the question manually; the review queue stays Draft-only.',
          })
        }

        const created = []
        for (const candidate of result.accepted) {
          const question = await createQuestion(db, {
            concept_id: input.concept_id,
            board: concept.board,
            class: concept.class,
            bloom: input.bloom,
            difficulty: input.difficulty,
            marks: input.marks,
            type: input.type,
            text: candidate.text,
            answer: candidate.answer,
            hint: candidate.hint,
            tags: candidate.tags,
            options: candidate.options?.map((o, index) => ({
              label: o.label,
              text: o.text,
              is_correct: o.is_correct,
              order_index: index,
            })),
            step_marks: candidate.step_marks,
            source_ref: candidate.in_scope_ref,
            created_by: auth.id,
            origin: 'ai_generated',
          })
          created.push(question)
        }

        return Response.json(
          {
            generated: created,
            rejected: result.rejected,
            ai_configured: true,
          },
          { status: created.length > 0 ? 201 : 200 },
        )
      },
    },
  },
})
