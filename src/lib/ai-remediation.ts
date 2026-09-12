import Anthropic from '@anthropic-ai/sdk'
import type { Db } from '../db/connection'
import { env } from './env'
import { enforceAiCallBudget, logAiJob } from './ai-metering'

// AI-09 in tab07: same "strong model" tier as AI-01/AI-05.
const MODEL = 'claude-sonnet-5'

let cachedClient: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null
  cachedClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return cachedClient
}

export function isAiRemediationConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

export interface WorkedExample {
  problem: string
  steps: Array<string>
}

export interface RemediationContent {
  refresher: string | null
  examples: Array<WorkedExample>
}

/**
 * AI-09 (tab07): "refresher (2-3 lines), 2 worked examples with steps." Returns null when no
 * ANTHROPIC_API_KEY is configured -- the documented fallback (tab07) is "serve existing bank
 * questions with no narrative", which the caller (buildRemediationPack) does by leaving
 * refresher/examples empty rather than guessing content.
 */
export async function generateRemediationContent(
  db: Db,
  input: {
    conceptName: string
    conceptIdea: string | null
    conceptRule: string | null
    conceptExample: string | null
    // F091: cached per-concept (F067) and reused across every student who needs it, but the call
    // that first generates it is still triggered by one student's Priority flag, so both are
    // known here.
    householdId: string
    studentId: string
  },
): Promise<RemediationContent | null> {
  const client = getClient()
  if (!client) return null
  await enforceAiCallBudget(db, {
    feature: 'AI-09',
    model: MODEL,
    householdId: input.householdId,
    studentId: input.studentId,
  })

  const prompt = `A CBSE Class 7 Mathematics student has just been flagged as needing extra practice on one concept. Write a short refresher and two worked examples to help them before they attempt practice questions.

Concept: ${input.conceptName}
${input.conceptIdea ? `Idea: ${input.conceptIdea}\n` : ''}${input.conceptRule ? `Rule: ${input.conceptRule}\n` : ''}${input.conceptExample ? `Existing worked example: ${input.conceptExample}\n` : ''}
Respond with ONLY a JSON object, no other text, matching exactly:
{
  "refresher": "2-3 short sentences re-teaching the core idea, plain language, no jargon",
  "examples": [
    {"problem": "a worked problem statement", "steps": ["step 1", "step 2", "..."]},
    {"problem": "a second, different worked problem statement", "steps": ["step 1", "step 2", "..."]}
  ]
}`

  const startedAt = Date.now()
  let response: Awaited<ReturnType<typeof client.messages.create>>
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    await logAiJob(db, {
      feature: 'AI-09',
      model: MODEL,
      householdId: input.householdId,
      studentId: input.studentId,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  await logAiJob(db, {
    feature: 'AI-09',
    model: MODEL,
    householdId: input.householdId,
    studentId: input.studentId,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
    latencyMs: Date.now() - startedAt,
    status: 'success',
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return { refresher: null, examples: [] }

  try {
    const parsed = JSON.parse(textBlock.text) as {
      refresher?: string
      examples?: Array<{ problem: string; steps: Array<string> }>
    }
    return {
      refresher: typeof parsed.refresher === 'string' ? parsed.refresher : null,
      examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    }
  } catch {
    return { refresher: null, examples: [] }
  }
}
