// F094: "Task-to-model map (cheap model for classification, strong model for generation and
// grading) with automatic fallback on failure." Mirrors tab07's own "Model Tier" column verbatim
// -- every AI-*.ts function this codebase has actually implemented (AI-01/05/09) already used a
// single hardcoded 'claude-sonnet-5' constant; this file is the one place that decision now lives,
// and it's declarative for the tab07 functions this codebase hasn't built yet too (AI-02/07/08/11,
// ...) so a future implementation plugs into an entry that already exists rather than inventing
// its own model string.
import { resolveProviderChain } from './ai-provider'
import type { AiProvider } from './ai-provider'
import { env } from './env'

export type ModelTier = 'strong' | 'mid' | 'cheap'

export const MODEL_TIER_BY_FEATURE: Partial<Record<string, ModelTier>> = {
  'AI-01': 'strong', // Question generation
  'AI-02': 'cheap', // Distractor quality check
  'AI-05': 'strong', // Subjective answer grading
  'AI-06': 'strong', // Handwriting transcription (vision)
  'AI-07': 'mid', // Error pattern classification
  'AI-08': 'mid', // Feedback line writing
  'AI-09': 'strong', // Remediation pack authoring
  'AI-10': 'strong', // Diagnosis narrative
  'AI-11': 'mid', // Weekly summary
  // F126. Strong, not mid, despite being short: this text is shown to a child as the reason an
  // answer is right, and a confidently wrong explanation is worse than none at all. The cost of
  // the stronger tier is paid once per question ever (cached in question_explanations), not once
  // per student who reads it.
  'AI-13': 'strong', // Per-question worked explanation
}

// Claude Sonnet 5 is the only "strong" model this app has ever called (ai-grading.ts /
// ai-remediation.ts / ai-question-generation.ts all hardcoded it before this file existed).
// Haiku 4.5 is the documented "cheap" tier -- same vendor/API shape, materially lower cost per
// the published rate card, appropriate for an advisory, non-final check like AI-02. No "mid"
// model has been identified/provisioned separately yet (documented gap, not a guess) -- it
// defaults to the strong model until one is, so a mid-tier feature never silently downgrades
// quality by resolving to an unintended tier.
const ANTHROPIC_MODELS: Record<ModelTier, string> = {
  strong: 'claude-sonnet-5',
  mid: 'claude-sonnet-5',
  cheap: 'claude-haiku-4-5-20251001',
}

// Gemini: Flash is the strong tier because it is available on the free plan; Flash-Lite is the
// cheap tier. Override either with GEMINI_MODEL_STRONG / GEMINI_MODEL_CHEAP (e.g. a Pro model).
//
// 2026-09-24: the 2.5 generation was retired without notice -- every AI-13 (F126 explanation)
// call in production failed with a Gemini 404 ("This model models/gemini-2.5-flash-lite is no
// longer available to new users. Please update your code to use models/gemini-3.5-flash-lite"),
// which is why the defaults below are 3.5, not 2.5. Confirmed for both names directly from
// production ai_jobs after the fix deployed (both gemini-3.5-flash and gemini-3.5-flash-lite have
// succeeded there). If Gemini retires a generation again, ai_jobs.error on a fresh row has the
// live model name -- same for any provider below.
function geminiModels(): Record<ModelTier, string> {
  const strong = env.GEMINI_MODEL_STRONG ?? 'gemini-3.5-flash'
  return {
    strong,
    mid: strong,
    cheap: env.GEMINI_MODEL_CHEAP ?? 'gemini-3.5-flash-lite',
  }
}

// 2026-09-24, user request ("another option of api key along with gemini and side by side...
// groq, cerebras, openrouter"): three more vendors, each checked against its own current docs
// before picking a default (not remembered/guessed) --
//   Groq:       console.groq.com/docs -- llama-3.3-70b-versatile (strong), llama-3.1-8b-instant
//               (cheap), both explicitly current in Groq's own docs as of this date.
//   Cerebras:   inference-docs.cerebras.ai -- gpt-oss-120b (strong), a materially smaller model
//               for cheap; Cerebras's own docs excerpt available at research time was partial, so
//               this is the least-confirmed of the three defaults here -- ai_jobs.error is the
//               fallback verification if it's wrong, same as Gemini's fix was.
//   OpenRouter: an aggregator, not a vendor of its own models -- model ids are "vendor/model"
//               (e.g. "meta-llama/llama-3.3-70b-instruct"); a well-known free-tier-eligible model
//               is used as the default since OpenRouter's whole point here is breadth/fallback,
//               not a specific vendor's flagship.
// All three: override with <PROVIDER>_MODEL_STRONG / <PROVIDER>_MODEL_CHEAP if a default is wrong
// or a different model is preferred.
function groqModels(): Record<ModelTier, string> {
  const strong = env.GROQ_MODEL_STRONG ?? 'llama-3.3-70b-versatile'
  return {
    strong,
    mid: strong,
    cheap: env.GROQ_MODEL_CHEAP ?? 'llama-3.1-8b-instant',
  }
}

function cerebrasModels(): Record<ModelTier, string> {
  const strong = env.CEREBRAS_MODEL_STRONG ?? 'gpt-oss-120b'
  return {
    strong,
    mid: strong,
    cheap: env.CEREBRAS_MODEL_CHEAP ?? 'llama3.1-8b',
  }
}

function openrouterModels(): Record<ModelTier, string> {
  const strong =
    env.OPENROUTER_MODEL_STRONG ?? 'meta-llama/llama-3.3-70b-instruct'
  return {
    strong,
    mid: strong,
    cheap: env.OPENROUTER_MODEL_CHEAP ?? 'meta-llama/llama-3.2-3b-instruct',
  }
}

function modelsFor(provider: AiProvider): Record<ModelTier, string> {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_MODELS
    case 'gemini':
      return geminiModels()
    case 'groq':
      return groqModels()
    case 'cerebras':
      return cerebrasModels()
    case 'openrouter':
      return openrouterModels()
  }
}

export function modelForFeature(feature: string, provider: AiProvider): string {
  const tier = MODEL_TIER_BY_FEATURE[feature]
  if (!tier) {
    throw new Error(
      `ai-models: no model tier mapped for AI feature "${feature}"`,
    )
  }
  return modelsFor(provider)[tier]
}

/** The cheap-tier model of a vendor -- used by the admin ai-status check, a cheap/fast smoke test. */
export function fallbackModel(provider: AiProvider): string {
  return modelsFor(provider).cheap
}

// Kept for src/lib/ai-metering.ts's rate lookup, which pre-dates the provider chain and still
// wants "the cheap Anthropic model" as its one hardcoded reference point.
export const FALLBACK_MODEL = ANTHROPIC_MODELS.cheap

// "provider/model" -- what actually goes in ai_jobs.model now (previously just a bare model name,
// e.g. "claude-sonnet-5"). Necessary once more than one vendor can serve the same feature: a bare
// model name is no longer enough to know which vendor's rate card applies (src/lib/ai-metering.ts's
// ratesFor), or, for a name like a Groq/Cerebras/OpenRouter-hosted open model, which vendor it even
// ran on at all. Existing rows from before this change keep their old bare-name model column;
// ratesFor treats an unprefixed model as Anthropic, its original assumption, for those.
export function modelLabel(provider: AiProvider, model: string): string {
  return `${provider}/${model}`
}

export interface ProviderChainResult<T> {
  result: T
  provider: AiProvider
  model: string
  label: string
}

export interface ChainAttempt {
  provider: AiProvider
  model: string
  error: string
}

// 2026-09-24: every ai-*.ts caller's error-path logAiJob() logged its own constant MODEL, not
// whichever model actually threw -- harmless while the primary model worked, but the exact case
// that needed this (Gemini retiring the 2.5 generation) is also the case where it matters.
// Extended the same day, same reason: an early version of this only kept the LAST provider's
// failure, silently dropping every earlier one in the chain -- so when Groq was added and this
// still showed only a Gemini error, there was no way to tell from ai_jobs alone whether Groq was
// even tried and failed, or never reached at all (no key, wrong chain order, ...). `attempts`
// carries every (provider, model, error) tried, in order, so the message alone answers that.
export class ModelCallError extends Error {
  readonly failedProvider: AiProvider
  readonly failedModel: string
  readonly label: string
  readonly attempts: Array<ChainAttempt>
  constructor(attempts: Array<ChainAttempt>) {
    const last = attempts[attempts.length - 1]
    const summary = attempts
      .map((a) => `${a.provider}/${a.model}: ${a.error}`)
      .join(' | ')
    super(summary)
    this.name = 'ModelCallError'
    this.failedProvider = last.provider
    this.failedModel = last.model
    this.label = modelLabel(last.provider, last.model)
    this.attempts = attempts
  }
}

/**
 * F094 "automatic fallback on failure", extended 2026-09-24 into a real cross-vendor chain: tries
 * every configured provider's strong-tier model for `feature`, in resolveProviderChain()'s
 * priority order, until one succeeds. A single vendor's own outage or rate limit no longer needs a
 * same-vendor retry to paper over (Gemini's within-vendor Flash/Flash-Lite fallback used to be the
 * only fallback that existed) -- a different vendor's infrastructure is a real independent path.
 * Throws a ModelCallError carrying every attempt made if every configured provider fails, or a
 * plain Error immediately if none is configured at all.
 */
export async function callWithProviderChain<T>(
  feature: string,
  fn: (provider: AiProvider, model: string) => Promise<T>,
  config: Parameters<typeof resolveProviderChain>[0] = undefined,
): Promise<ProviderChainResult<T>> {
  const chain = resolveProviderChain(config)
  if (chain.length === 0) {
    throw new Error(
      `callWithProviderChain: no AI provider is configured (feature "${feature}")`,
    )
  }
  const attempts: Array<ChainAttempt> = []
  for (const provider of chain) {
    const model = modelForFeature(feature, provider)
    try {
      const result = await fn(provider, model)
      return { result, provider, model, label: modelLabel(provider, model) }
    } catch (err) {
      attempts.push({
        provider,
        model,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  throw new ModelCallError(attempts)
}
