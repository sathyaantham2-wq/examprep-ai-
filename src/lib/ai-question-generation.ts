import Anthropic from '@anthropic-ai/sdk'
import type { BloomLevel, DifficultyTier, QuestionType } from '../db/enums'
import { env } from './env'

// AI-01 in tab07: same "strong model" tier as AI-05's subjective grading.
const MODEL = 'claude-sonnet-5'

let cachedClient: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null
  cachedClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return cachedClient
}

export function isAiQuestionGenerationConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
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

// Claude Sonnet 5 published rate: $2.00 / 1M input tokens, $10.00 / 1M output tokens. INR
// conversion uses a fixed approximate rate (documented assumption, not a live FX lookup) since
// there's no billing/FX infrastructure in this app yet -- F091 (cost dashboard) owns doing this
// properly with real per-call metering.
const USD_PER_1M_INPUT = 2.0
const USD_PER_1M_OUTPUT = 10.0
const USD_TO_INR = 83

export function estimateCostInr(usage: {
  inputTokens: number
  outputTokens: number
}): number {
  const usd =
    (usage.inputTokens / 1_000_000) * USD_PER_1M_INPUT +
    (usage.outputTokens / 1_000_000) * USD_PER_1M_OUTPUT
  return usd * USD_TO_INR
}

const OBJECTIVE_TYPES = new Set<QuestionType>([
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'fill_blank',
])

/**
 * AI-01 (tab07): drafts up to `input.count` questions for one concept at a fixed Bloom level and
 * difficulty. Returns null when no ANTHROPIC_API_KEY is configured -- the caller's documented
 * fallback (per tab07) is "admin writes the question manually; queue stays draft", not a guess.
 *
 * Guardrail: every accepted candidate must name which IN-scope item it tests (`in_scope_ref`),
 * checked here against the actual IN-scope text this call sent -- not just trusted from the
 * model's own claim -- and OUT-scope items are listed in the prompt as explicitly forbidden
 * ideas. A candidate that fails either check is dropped into `rejected`, never saved.
 */
export async function generateQuestions(
  input: GenerateQuestionsInput,
): Promise<GenerateQuestionsResult | null> {
  const client = getClient()
  if (!client) return null

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

  const prompt = `You write exam questions for CBSE Class 7 Mathematics (NCERT Ganita Prakash), strictly for the concept and scope given below. Never use an idea, formula, or term that is not in the IN-scope list or the concept's own idea/rule/example — if you need something from OUT-of-scope or beyond it, do not write that question.

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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return { accepted: [], rejected: [], usage }

  let parsed: unknown
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    return {
      accepted: [],
      rejected: [{ reason: 'Model output was not valid JSON', raw: textBlock.text }],
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
    const inScopeRef = typeof c.in_scope_ref === 'string' ? c.in_scope_ref.trim() : ''

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
      rejected.push({ reason: 'Question text references an OUT-of-scope item', raw })
      continue
    }
    if (ctx.isMcq) {
      const options = Array.isArray(c.options) ? (c.options) : []
      const correctCount = options.filter((o) => o?.is_correct).length
      if (options.length < 2 || correctCount !== 1) {
        rejected.push({ reason: 'mcq must have >=2 options with exactly one is_correct', raw })
        continue
      }
    }
    if (ctx.marks >= 3) {
      const stepMarks = Array.isArray(c.step_marks) ? (c.step_marks) : []
      const sum = stepMarks.reduce((total, s) => total + (Number(s?.marks) || 0), 0)
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
        ? (c.options as Array<{ label: string; text: string; is_correct: boolean }>)
        : undefined,
      step_marks:
        ctx.marks >= 3 ? (c.step_marks as GeneratedQuestionCandidate['step_marks']) : undefined,
      in_scope_ref: inScopeRef,
    })
  }

  return { accepted, rejected }
}

export { OBJECTIVE_TYPES }
