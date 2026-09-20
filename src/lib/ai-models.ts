// F094: "Task-to-model map (cheap model for classification, strong model for generation and
// grading) with automatic fallback on failure." Mirrors tab07's own "Model Tier" column verbatim
// -- every AI-*.ts function this codebase has actually implemented (AI-01/05/09) already used a
// single hardcoded 'claude-sonnet-5' constant; this file is the one place that decision now lives,
// and it's declarative for the tab07 functions this codebase hasn't built yet too (AI-02/07/08/11,
// ...) so a future implementation plugs into an entry that already exists rather than inventing
// its own model string.
import { activeProvider } from './ai-provider'
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
function geminiModels(): Record<ModelTier, string> {
  const strong = env.GEMINI_MODEL_STRONG ?? 'gemini-2.5-flash'
  return { strong, mid: strong, cheap: env.GEMINI_MODEL_CHEAP ?? 'gemini-2.5-flash-lite' }
}

function modelsFor(provider: AiProvider): Record<ModelTier, string> {
  return provider === 'gemini' ? geminiModels() : ANTHROPIC_MODELS
}

export function modelForFeature(
  feature: string,
  provider: AiProvider = activeProvider() ?? 'anthropic',
): string {
  const tier = MODEL_TIER_BY_FEATURE[feature]
  if (!tier) {
    throw new Error(`ai-models: no model tier mapped for AI feature "${feature}"`)
  }
  return modelsFor(provider)[tier]
}

/** The cheap-tier model of the active vendor, used as the retry model. */
export function fallbackModel(provider: AiProvider = activeProvider() ?? 'anthropic'): string {
  return modelsFor(provider).cheap
}

// The fallback model on a primary-model failure -- deliberately the cheap tier's model rather
// than retrying the same strong model, since a genuine outage/overload on one model is unlikely
// to clear in the time of a single retry, while a different model is a real independent path
// that might still answer. Never the fallback FOR ITSELF: see callWithModelFallback below.
export const FALLBACK_MODEL = ANTHROPIC_MODELS.cheap

export interface ModelFallbackResult<T> {
  result: T
  modelUsed: string
  usedFallback: boolean
}

/**
 * F094: "automatic fallback on failure." Calls `fn` with `primaryModel`; if that throws, retries
 * once with FALLBACK_MODEL and reports which model actually produced the result so the caller can
 * log it accurately (ai_jobs.model). If `primaryModel` already *is* the fallback model, there is
 * nothing left to fall back to -- the original error propagates rather than calling the exact same
 * model twice. If the fallback attempt also throws, that second error propagates (not the first),
 * since it's the more recent, more relevant failure for the caller's own error log.
 */
export async function callWithModelFallback<T>(
  primaryModel: string,
  fn: (model: string) => Promise<T>,
): Promise<ModelFallbackResult<T>> {
  try {
    const result = await fn(primaryModel)
    return { result, modelUsed: primaryModel, usedFallback: false }
  } catch (err) {
    const retryModel = fallbackModel()
    if (primaryModel === retryModel) throw err
    const result = await fn(retryModel)
    return { result, modelUsed: retryModel, usedFallback: true }
  }
}
