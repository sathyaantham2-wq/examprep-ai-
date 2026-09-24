import Anthropic from '@anthropic-ai/sdk'
import { env } from './env'

// The one place that talks to an AI vendor. Every AI feature (grading, question writing,
// remediation) asks for "a completion" and never mentions a vendor, so Anthropic (Claude) and
// Google Gemini can be swapped by configuration alone.
export type AiProvider = 'anthropic' | 'gemini'

export interface ProviderConfig {
  AI_PROVIDER?: AiProvider
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
}

/**
 * Which vendor to use. AI_PROVIDER forces one (and yields null if that vendor has no key, rather
 * than silently using the other). Left unset, Anthropic wins when both keys exist, then Gemini.
 */
export function resolveProvider(config: ProviderConfig = env): AiProvider | null {
  if (config.AI_PROVIDER === 'anthropic') return config.ANTHROPIC_API_KEY ? 'anthropic' : null
  if (config.AI_PROVIDER === 'gemini') return config.GEMINI_API_KEY ? 'gemini' : null
  if (config.ANTHROPIC_API_KEY) return 'anthropic'
  if (config.GEMINI_API_KEY) return 'gemini'
  return null
}

export function activeProvider(): AiProvider | null {
  return resolveProvider()
}

export function isAiConfigured(): boolean {
  return activeProvider() !== null
}

export interface CompletionImage {
  mediaType: string
  // Base64 without the "data:...;base64," prefix.
  base64: string
}

export interface CompletionInput {
  model: string
  prompt: string
  maxTokens: number
  // Photos the model should look at (handwriting). Both vendors accept them.
  images?: Array<CompletionImage>
}

export interface CompletionResult {
  // null when the model returned nothing usable (blocked, empty, or no text part).
  text: string | null
  tokensIn: number
  tokensOut: number
}

/** Models sometimes wrap JSON in a markdown fence even when told not to. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match ? match[1] : trimmed
}

let anthropicClient: { key: string; client: Anthropic } | null = null

async function completeAnthropic(input: CompletionInput, apiKey: string): Promise<CompletionResult> {
  if (anthropicClient?.key !== apiKey) {
    anthropicClient = { key: apiKey, client: new Anthropic({ apiKey }) }
  }
  const response = await anthropicClient.client.messages.create({
    model: input.model,
    max_tokens: input.maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          ...(input.images ?? []).map((image) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: image.base64,
            },
          })),
          { type: 'text' as const, text: input.prompt },
        ],
      },
    ],
  })
  const block = response.content.find((b) => b.type === 'text')
  return {
    text: block ? stripCodeFence(block.text) : null,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
  }
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

async function completeGemini(input: CompletionInput, apiKey: string): Promise<CompletionResult> {
  const response = await fetch(`${GEMINI_BASE}/${encodeURIComponent(input.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            ...(input.images ?? []).map((image) => ({
              inlineData: { mimeType: image.mediaType, data: image.base64 },
            })),
            { text: input.prompt },
          ],
        },
      ],
      generationConfig: {
        // 2026-09-24, user request ("optimise... time to first token _most important for user
        // experience"): every AI-13 call observed in production took 15-46s, almost certainly
        // Gemini's extended "thinking" phase before it emits any output -- none of this app's
        // prompts (a 2-4 step explanation, a grading justification, a distractor check) are the
        // kind of deep multi-step reasoning task thinking mode is for, and the existing Anthropic
        // path (completeAnthropic above) has never used extended thinking either, so this brings
        // Gemini in line with the quality bar the app already assumes. thinkingBudget: 0 disables
        // it outright (0-24576 range, -1 is dynamic/auto) -- confirmed against ai_jobs.error after
        // deploy, the same way the 2.5->3.5 model-name fix was, in case this field name has also
        // moved since (Gemini's newer docs describe a thinking_level enum for some model lines).
        thinkingConfig: { thinkingBudget: 0 },
        // maxOutputTokens no longer needs the x4 headroom for a reasoning budget it won't spend.
        maxOutputTokens: input.maxTokens,
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Gemini API ${response.status}: ${body.slice(0, 200)}`)
  }
  const data = (await response.json()) as GeminiResponse
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
  const usage = data.usageMetadata ?? {}
  return {
    text: data.promptFeedback?.blockReason || text.length === 0 ? null : stripCodeFence(text),
    tokensIn: usage.promptTokenCount ?? 0,
    tokensOut: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  }
}

/** One prompt in, one text out, from whichever vendor is configured. Throws on an API error. */
export async function completeText(
  input: CompletionInput,
  provider: AiProvider | null = activeProvider(),
  config: ProviderConfig = env,
): Promise<CompletionResult> {
  if (provider === 'anthropic' && config.ANTHROPIC_API_KEY) {
    return completeAnthropic(input, config.ANTHROPIC_API_KEY)
  }
  if (provider === 'gemini' && config.GEMINI_API_KEY) {
    return completeGemini(input, config.GEMINI_API_KEY)
  }
  throw new Error('No AI provider is configured')
}
