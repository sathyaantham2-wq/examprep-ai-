import { describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_MODEL,
  ModelCallError,
  callWithProviderChain,
  fallbackModel,
  modelForFeature,
} from './ai-models'

describe('modelForFeature (F094 task-to-model map)', () => {
  it('maps generation and grading to the strong model', () => {
    expect(modelForFeature('AI-01', 'anthropic')).toBe('claude-sonnet-5')
    expect(modelForFeature('AI-05', 'anthropic')).toBe('claude-sonnet-5')
  })

  it('maps a classification-type task to the cheap model', () => {
    expect(modelForFeature('AI-02', 'anthropic')).toBe(FALLBACK_MODEL)
  })

  it("maps to each vendor's own models", () => {
    expect(modelForFeature('AI-05', 'gemini')).toBe('gemini-3.5-flash')
    expect(modelForFeature('AI-02', 'gemini')).toBe('gemini-3.5-flash-lite')
    expect(modelForFeature('AI-05', 'groq')).toBe('llama-3.3-70b-versatile')
    expect(modelForFeature('AI-05', 'cerebras')).toBe('gpt-oss-120b')
    expect(modelForFeature('AI-05', 'openrouter')).toBe(
      'meta-llama/llama-3.3-70b-instruct',
    )
    expect(fallbackModel('gemini')).toBe('gemini-3.5-flash-lite')
    expect(fallbackModel('anthropic')).toBe(FALLBACK_MODEL)
  })

  it('throws for a feature with no mapped tier', () => {
    expect(() => modelForFeature('AI-99', 'anthropic')).toThrow(
      /no model tier mapped/i,
    )
  })
})

describe('callWithProviderChain (F094 automatic fallback on failure, cross-vendor since 2026-09-24)', () => {
  it("returns the first configured provider's result without trying any other", async () => {
    const fn = vi.fn().mockResolvedValue('primary result')
    const outcome = await callWithProviderChain('AI-05', fn, {
      ANTHROPIC_API_KEY: 'k',
      GEMINI_API_KEY: 'k',
    })
    expect(outcome.result).toBe('primary result')
    expect(outcome.provider).toBe('anthropic')
    expect(outcome.model).toBe('claude-sonnet-5')
    expect(outcome.label).toBe('anthropic/claude-sonnet-5')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('anthropic', 'claude-sonnet-5')
  })

  it('falls through to the next configured vendor in priority order when one throws', async () => {
    // Priority order is groq, cerebras, anthropic, openrouter, gemini -- with only groq and
    // anthropic configured, a groq failure should fall to anthropic next, skipping the
    // unconfigured cerebras entirely.
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('groq overloaded'))
      .mockResolvedValueOnce('anthropic result')
    const outcome = await callWithProviderChain('AI-05', fn, {
      GROQ_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
    })
    expect(outcome.result).toBe('anthropic result')
    expect(outcome.provider).toBe('anthropic')
    expect(fn).toHaveBeenNthCalledWith(1, 'groq', 'llama-3.3-70b-versatile')
    expect(fn).toHaveBeenNthCalledWith(2, 'anthropic', 'claude-sonnet-5')
  })

  it('throws a ModelCallError naming the last provider tried when every configured one fails', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('groq failed'))
      .mockRejectedValueOnce(new Error('anthropic also failed'))
    const promise = callWithProviderChain('AI-05', fn, {
      GROQ_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
    })
    await expect(promise).rejects.toThrow('anthropic also failed')
    await expect(promise).rejects.toBeInstanceOf(ModelCallError)
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(ModelCallError)
      if (err instanceof ModelCallError) {
        expect(err.failedProvider).toBe('anthropic')
        expect(err.failedModel).toBe('claude-sonnet-5')
        expect(err.label).toBe('anthropic/claude-sonnet-5')
      }
    }
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('keeps every attempt in the chain, not just the last -- the fix for a real diagnostic gap', async () => {
    // 2026-09-24: an earlier version of this only kept the last provider's failure, so when
    // Groq was added and a real production error still only ever named Gemini, there was no way
    // to tell whether Groq was even tried. This is what makes that answerable from the error
    // alone: every (provider, model, error) attempted, in order, and a message that says so.
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('groq: auth failed'))
      .mockRejectedValueOnce(new Error('cerebras: 503 overloaded'))
      .mockRejectedValueOnce(new Error('gemini: 503 high demand'))
    const promise = callWithProviderChain('AI-05', fn, {
      GROQ_API_KEY: 'k',
      CEREBRAS_API_KEY: 'k',
      GEMINI_API_KEY: 'k',
    })
    try {
      await promise
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ModelCallError)
      if (!(err instanceof ModelCallError)) return
      expect(err.attempts).toEqual([
        {
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          error: 'groq: auth failed',
        },
        {
          provider: 'cerebras',
          model: 'gpt-oss-120b',
          error: 'cerebras: 503 overloaded',
        },
        {
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          error: 'gemini: 503 high demand',
        },
      ])
      // The message alone (what lands in ai_jobs.error) names every vendor tried, not only the
      // last one -- this is the part that was actually missing in production.
      expect(err.message).toContain(
        'groq/llama-3.3-70b-versatile: groq: auth failed',
      )
      expect(err.message).toContain(
        'cerebras/gpt-oss-120b: cerebras: 503 overloaded',
      )
      expect(err.message).toContain(
        'gemini/gemini-3.5-flash: gemini: 503 high demand',
      )
    }
  })

  it('never calls a vendor with no key configured', async () => {
    const fn = vi.fn().mockResolvedValue('gemini result')
    const outcome = await callWithProviderChain('AI-05', fn, {
      GEMINI_API_KEY: 'k',
    })
    expect(outcome.provider).toBe('gemini')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws immediately, without calling fn, when nothing is configured', async () => {
    const fn = vi.fn()
    await expect(callWithProviderChain('AI-05', fn, {})).rejects.toThrow(
      /no ai provider is configured/i,
    )
    expect(fn).not.toHaveBeenCalled()
  })

  it('AI_PROVIDER forces exactly one vendor, even if others are also configured', async () => {
    const fn = vi.fn().mockResolvedValue('forced result')
    const outcome = await callWithProviderChain('AI-05', fn, {
      AI_PROVIDER: 'gemini',
      GROQ_API_KEY: 'k',
      GEMINI_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
    })
    expect(outcome.provider).toBe('gemini')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
