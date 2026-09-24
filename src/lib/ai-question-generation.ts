import type { Db } from '../db/connection'
import type { BloomLevel, DifficultyTier, QuestionType } from '../db/enums'
import { completeText, isAiConfigured } from './ai-provider'
import { enforceAiCallBudget, logAiJob } from './ai-metering'
import { ModelCallError, callWithProviderChain } from './ai-models'

// F094: resolved from tab07's task-to-model map (src/lib/ai-models.ts) rather than a hardcoded
// literal -- AI-01 is "strong model" tier, same as AI-05's subjective grading.
const FEATURE = 'AI-01'

export function isAiQuestionGenerationConfigured(): boolean {
  return isAiConfigured()
}

export interface ScopeItem {
  id: string
  kind: 'IN' | 'OUT'
  item_text: string
  page_ref: string | null
}

export interface ExemplarQuestion {
  text: string
  answer: string
}

export interface GenerateQuestionsInput {
  conceptName: string
  // e.g. "CBSE Class 9 Mathematics"; the class always comes from the concept, never a constant.
  syllabusLabel?: string
  conceptIdea: string | null
  conceptRule: string | null
  conceptExample: string | null
  scope: Array<ScopeItem>
  bloom: BloomLevel
  difficulty: DifficultyTier
  marks: number
  type: QuestionType
  count: number
  exemplars: Array<ExemplarQuestion>
  // F091: neither is known for most callers of AI-01 -- it's admin/global bank content
  // authoring, not tied to a household or a student. Left undefined there; runBatch/the manual
  // generate route both pass null explicitly so ai_jobs still logs the call with an honest
  // owner of "none" rather than silently skipping metering.
  householdId?: string | null
  studentId?: string | null
}

export interface GeneratedQuestionCandidate {
  text: string
  answer: string
  hint?: string
  tags: Array<string>
  options?: Array<{ label: string; text: string; is_correct: boolean }>
  step_marks?: Array<{ step_no: number; description: string; marks: number }>
  in_scope_ref: string
}

export interface GenerateQuestionsResult {
  accepted: Array<GeneratedQuestionCandidate>
  rejected: Array<{ reason: string; raw: unknown }>
  usage?: { inputTokens: number; outputTokens: number }
}

const OBJECTIVE_TYPES = new Set<QuestionType>([
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'fill_blank',
])

/**
 * AI-01 (tab07): generates up to `input.count` candidate questions for one concept at a fixed
 * Bloom level and difficulty. Returns null when no ANTHROPIC_API_KEY is configured -- the
 * caller's documented fallback (per tab07) is "admin adds the question manually", not a guess.
 *
 * Guardrail: every accepted candidate must name which IN-scope item it tests (`in_scope_ref`),
 * checked here against the actual IN-scope text this call sent -- not just trusted from the
 * model's own claim -- and OUT-scope items are listed in the prompt as explicitly forbidden
 * ideas. A candidate that fails either check is dropped into `rejected`, never saved.
 */
export async function generateQuestions(
  db: Db,
  input: GenerateQuestionsInput,
): Promise<GenerateQuestionsResult | null> {
  if (!isAiConfigured()) return null
  await enforceAiCallBudget(db, {
    feature: FEATURE,
    model: FEATURE,
    householdId: input.householdId ?? null,
    studentId: input.studentId,
  })

  const inScope = input.scope.filter((s) => s.kind === 'IN')
  const outScope = input.scope.filter((s) => s.kind === 'OUT')
  if (inScope.length === 0) {
    throw new Error(
      'This chapter has no IN-scope record — author chapter scope before generating questions.',
    )
  }

  const isMcq = input.type === 'mcq'
  const optionsInstruction = isMcq
    ? `"options": [{"label": "A", "text": "...", "is_correct": boolean}, ...exactly 4 options, exactly one is_correct:true],`
    : ''
  const stepMarksInstruction =
    input.marks >= 3
      ? `"step_marks": [{"step_no": number, "description": "...", "marks": number}, ...summing to exactly ${input.marks}],`
      : ''

  const prompt = `You write exam questions for ${input.syllabusLabel ?? 'CBSE school Mathematics'} (NCERT), strictly for the concept and scope given below. Never use an idea, formula, or term that is not in the IN-scope list or the concept's own idea/rule/example — if you need something from OUT-of-scope or beyond it, do not write that question.

Concept: ${input.conceptName}
${input.conceptIdea ? `Idea: ${input.conceptIdea}\n` : ''}${input.conceptRule ? `Rule: ${input.conceptRule}\n` : ''}${input.conceptExample ? `Worked example: ${input.conceptExample}\n` : ''}
IN-scope items this chapter actually covers (you must pick one per question and quote it back exactly in "in_scope_ref"):
${inScope.map((s) => `- ${s.item_text}`).join('\n')}

OUT-of-scope items — forbidden, do not test these even indirectly:
${outScope.length > 0 ? outScope.map((s) => `- ${s.item_text}`).join('\n') : '(none recorded)'}

${input.exemplars.length > 0 ? `Style exemplars already in the bank for this concept (match tone and length, do not copy):\n${input.exemplars.map((e) => `- Q: ${e.text}\n  A: ${e.answer}`).join('\n')}\n` : ''}
Write exactly ${input.count} question(s):
- Bloom level: ${input.bloom}
- Difficulty: ${input.difficulty}
- Type: ${input.type}
- Marks: ${input.marks}

Respond with ONLY a JSON array, no other text, each element matching exactly:
{
  "text": "the question text",
  ${optionsInstruction}
  "answer": "the final answer",
  "hint": "one short hint sentence",
  ${stepMarksInstruction}
  "tags": ["short topical tags"],
  "in_scope_ref": "the exact IN-scope item text this question tests, copied verbatim from the list above"
}`

  const startedAt = Date.now()
  let response: Awaited<ReturnType<typeof completeText>>
  let modelUsed = FEATURE
  try {
    // 2026-09-24: tries every configured vendor in priority order, not just one vendor's tiers.
    const outcome = await callWithProviderChain(FEATURE, (provider, model) =>
      completeText({ model, prompt, maxTokens: 4096 }, provider),
    )
    response = outcome.result
    modelUsed = outcome.label
  } catch (err) {
    // Log whichever (provider, model) pair actually threw last, not a guess.
    await logAiJob(db, {
      feature: FEATURE,
      model: err instanceof ModelCallError ? err.label : FEATURE,
      householdId: input.householdId,
      studentId: input.studentId,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  const usage = {
    inputTokens: response.tokensIn,
    outputTokens: response.tokensOut,
  }
  await logAiJob(db, {
    feature: FEATURE,
    model: modelUsed,
    householdId: input.householdId,
    studentId: input.studentId,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    latencyMs: Date.now() - startedAt,
    status: 'success',
  })

  if (!response.text) return { accepted: [], rejected: [], usage }
  const outputText = response.text

  let parsed: unknown
  try {
    parsed = JSON.parse(outputText)
  } catch {
    return {
      accepted: [],
      rejected: [
        { reason: 'Model output was not valid JSON', raw: outputText },
      ],
      usage,
    }
  }

  return {
    ...validateCandidates(Array.isArray(parsed) ? parsed : [parsed], {
      inScope,
      outScope,
      isMcq,
      marks: input.marks,
    }),
    usage,
  }
}

/**
 * The deterministic half of AI-01's guardrail — pulled out of generateQuestions() so it can be
 * unit-tested against fabricated model output without a network call or an API key. Every check
 * here re-verifies a claim the model made rather than trusting it, per tab07's "reject if it uses
 * an OUT-scope idea" guardrail.
 */
export function validateCandidates(
  candidates: Array<unknown>,
  ctx: {
    inScope: Array<ScopeItem>
    outScope: Array<ScopeItem>
    isMcq: boolean
    marks: number
  },
): GenerateQuestionsResult {
  const inScopeTexts = new Set(ctx.inScope.map((s) => s.item_text.trim()))
  const outScopeTexts = ctx.outScope.map((s) => s.item_text.toLowerCase())

  const accepted: Array<GeneratedQuestionCandidate> = []
  const rejected: Array<{ reason: string; raw: unknown }> = []

  for (const raw of candidates) {
    const c = raw as Record<string, unknown>
    const text = typeof c.text === 'string' ? c.text : ''
    const answer = typeof c.answer === 'string' ? c.answer : ''
    const inScopeRef =
      typeof c.in_scope_ref === 'string' ? c.in_scope_ref.trim() : ''

    if (!text || !answer) {
      rejected.push({ reason: 'Missing text or answer', raw })
      continue
    }
    if (!inScopeTexts.has(inScopeRef)) {
      rejected.push({
        reason:
          'in_scope_ref did not match a real IN-scope item — cannot trace this question to scope',
        raw,
      })
      continue
    }
    const mentionsOutScope = outScopeTexts.some(
      (out) => out.length > 0 && text.toLowerCase().includes(out),
    )
    if (mentionsOutScope) {
      rejected.push({
        reason: 'Question text references an OUT-of-scope item',
        raw,
      })
      continue
    }
    if (ctx.isMcq) {
      const options = Array.isArray(c.options) ? c.options : []
      const correctCount = options.filter((o) => o?.is_correct).length
      if (options.length < 2 || correctCount !== 1) {
        rejected.push({
          reason: 'mcq must have >=2 options with exactly one is_correct',
          raw,
        })
        continue
      }
    }
    if (ctx.marks >= 3) {
      const stepMarks = Array.isArray(c.step_marks) ? c.step_marks : []
      const sum = stepMarks.reduce(
        (total, s) => total + (Number(s?.marks) || 0),
        0,
      )
      if (stepMarks.length === 0 || sum !== ctx.marks) {
        rejected.push({ reason: `step_marks must sum to ${ctx.marks}`, raw })
        continue
      }
    }

    accepted.push({
      text,
      answer,
      hint: typeof c.hint === 'string' ? c.hint : undefined,
      tags: Array.isArray(c.tags)
        ? c.tags.filter((t): t is string => typeof t === 'string')
        : [],
      options: ctx.isMcq
        ? (c.options as Array<{
            label: string
            text: string
            is_correct: boolean
          }>)
        : undefined,
      step_marks:
        ctx.marks >= 3
          ? (c.step_marks as GeneratedQuestionCandidate['step_marks'])
          : undefined,
      in_scope_ref: inScopeRef,
    })
  }

  return { accepted, rejected }
}

export { OBJECTIVE_TYPES }
