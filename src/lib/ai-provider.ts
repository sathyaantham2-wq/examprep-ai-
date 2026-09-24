import Anthropic from '@anthropic-ai/sdk'
import { env } from './env'

// The one place that talks to an AI vendor. Every AI feature (grading, question writing,
// remediation) asks for "a completion" and never mentions a vendor, so any of these can be swapped
// -- or, since 2026-09-24 (user request: "another option of api key along with gemini and side by
// side"), used together as an automatic fallback chain -- by configuration alone. Groq, Cerebras
// and OpenRouter are all OpenAI-compatible chat-completions APIs and share one implementation
// (completeOpenAiCompatible); Anthropic and Gemini keep their own vendor-specific shapes.
export type AiProvider =
  'anthropic' | 'gemini' | 'groq' | 'cerebras' | 'openrouter'

export interface ProviderConfig {
  AI_PROVIDER?: AiProvider
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
  GROQ_API_KEY?: string
  CEREBRAS_API_KEY?: string
  OPENROUTER_API_KEY?: string
}

// Groq and Cerebras first: both run on purpose-built inference hardware and are the fastest
// vendors this app has used (the whole reason they were added -- "time to first token" was the
// user's stated priority). Anthropic next, when configured: no free-tier reliability issues, the
// vendor every other AI feature already defaulted to before Gemini existed. OpenRouter next: a
// broad aggregator fallback across many hosted models. Gemini last: confirmed in this app's own
// production ai_jobs to be the slowest (15-46s) and the one that hits real capacity 503s.
const PROVIDER_PRIORITY: Array<AiProvider> = [
  'groq',
  'cerebras',
  'anthropic',
  'openrouter',
  'gemini',
]

function hasKey(config: ProviderConfig, provider: AiProvider): boolean {
  switch (provider) {
    case 'anthropic':
      return Boolean(config.ANTHROPIC_API_KEY)
    case 'gemini':
      return Boolean(config.GEMINI_API_KEY)
    case 'groq':
      return Boolean(config.GROQ_API_KEY)
    case 'cerebras':
      return Boolean(config.CEREBRAS_API_KEY)
    case 'openrouter':
      return Boolean(config.OPENROUTER_API_KEY)
  }
}

/**
 * Every configured vendor, in fallback order. AI_PROVIDER, if set, forces exactly that one vendor
 * (an empty chain if it has no key, rather than silently falling through to another) -- the same
 * "force one, never silently substitute" contract resolveProvider() always had. Left unset, this
 * is PROVIDER_PRIORITY filtered down to whichever vendors actually have a key.
 */
export function resolveProviderChain(
  config: ProviderConfig = env,
): Array<AiProvider> {
  if (config.AI_PROVIDER) {
    return hasKey(config, config.AI_PROVIDER) ? [config.AI_PROVIDER] : []
  }
  return PROVIDER_PRIORITY.filter((p) => hasKey(config, p))
}

/** The first (highest-priority) configured vendor, or null if none is. */
export function resolveProvider(
  config: ProviderConfig = env,
): AiProvider | null {
  return resolveProviderChain(config)[0] ?? null
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
  // Photos the model should look at (handwriting). Every vendor here accepts them at the API
  // level; whether the specific MODEL configured for a vendor is actually vision-capable is not
  // checked here -- a text-only model asked to read a photo just answers about the prompt text
  // alone. No AI-06 (handwriting transcription) caller exists yet to have hit this; if one is
  // built, it should pin a known-multimodal provider/model rather than trust the general chain.
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

async function completeAnthropic(
  input: CompletionInput,
  apiKey: string,
): Promise<CompletionResult> {
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
              media_type: image.mediaType as
                'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
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

async function completeGemini(
  input: CompletionInput,
  apiKey: string,
): Promise<CompletionResult> {
  const response = await fetch(
    `${GEMINI_BASE}/${encodeURIComponent(input.model)}:generateContent`,
    {
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
    },
  )
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
    text:
      data.promptFeedback?.blockReason || text.length === 0
        ? null
        : stripCodeFence(text),
    tokensIn: usage.promptTokenCount ?? 0,
    tokensOut:
      (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  }
}

// Groq, Cerebras and OpenRouter all speak the OpenAI chat-completions shape. Verified directly
// against each vendor's own current docs 2026-09-24 (base URL, auth header, response_format
// support) rather than assumed -- the exact mistake that broke Gemini (src/lib/ai-models.ts's own
// history) was trusting a remembered API shape instead of a live one.
interface OpenAiCompatibleResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

async function completeOpenAiCompatible(
  input: CompletionInput,
  apiKey: string,
  baseUrl: string,
): Promise<CompletionResult> {
  const images = input.images ?? []
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: 'user',
          // A plain string when there's nothing to look at, matching the simplest form every
          // OpenAI-compatible vendor accepts; the multimodal content-parts array only when a
          // photo is actually attached (see CompletionInput.images's own note on vision support).
          content:
            images.length > 0
              ? [
                  ...images.map((image) => ({
                    type: 'image_url' as const,
                    image_url: {
                      url: `data:${image.mediaType};base64,${image.base64}`,
                    },
                  })),
                  { type: 'text' as const, text: input.prompt },
                ]
              : input.prompt,
        },
      ],
      max_tokens: input.maxTokens,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`${baseUrl} ${response.status}: ${body.slice(0, 200)}`)
  }
  const data = (await response.json()) as OpenAiCompatibleResponse
  const text = data.choices?.[0]?.message?.content
  return {
    text: text ? stripCodeFence(text) : null,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  }
}

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const CEREBRAS_BASE = 'https://api.cerebras.ai/v1'
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/** One prompt in, one text out, from whichever vendor is named. Throws on an API error. */
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
  if (provider === 'groq' && config.GROQ_API_KEY) {
    return completeOpenAiCompatible(input, config.GROQ_API_KEY, GROQ_BASE)
  }
  if (provider === 'cerebras' && config.CEREBRAS_API_KEY) {
    return completeOpenAiCompatible(
      input,
      config.CEREBRAS_API_KEY,
      CEREBRAS_BASE,
    )
  }
  if (provider === 'openrouter' && config.OPENROUTER_API_KEY) {
    return completeOpenAiCompatible(
      input,
      config.OPENROUTER_API_KEY,
      OPENROUTER_BASE,
    )
  }
  throw new Error('No AI provider is configured')
}
