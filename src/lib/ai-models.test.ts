import { describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_MODEL,
  callWithModelFallback,
  fallbackModel,
  modelForFeature,
} from './ai-models'

describe('modelForFeature (F094 task-to-model map)', () => {
  it('maps generation and grading to the strong model', () => {
    expect(modelForFeature('AI-01')).toBe('claude-sonnet-5')
    expect(modelForFeature('AI-05')).toBe('claude-sonnet-5')
  })

  it('maps a classification-type task to the cheap model', () => {
    expect(modelForFeature('AI-02')).toBe(FALLBACK_MODEL)
  })

  it('maps to Gemini models when the provider is Gemini', () => {
    expect(modelForFeature('AI-05', 'gemini')).toBe('gemini-3.5-flash')
    expect(modelForFeature('AI-02', 'gemini')).toBe('gemini-3.5-flash-lite')
    expect(fallbackModel('gemini')).toBe('gemini-3.5-flash-lite')
    expect(fallbackModel('anthropic')).toBe(FALLBACK_MODEL)
  })

  it('throws for a feature with no mapped tier', () => {
    expect(() => modelForFeature('AI-99')).toThrow(/no model tier mapped/i)
  })
})

describe('callWithModelFallback (F094 automatic fallback on failure)', () => {
  it("returns the primary model's result without ever calling the fallback", async () => {
    const fn = vi.fn().mockResolvedValue('primary result')
    const outcome = await callWithModelFallback('strong-model', fn)
    expect(outcome).toEqual({
      result: 'primary result',
      modelUsed: 'strong-model',
      usedFallback: false,
    })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('strong-model')
  })

  it('retries with the fallback model when the primary call throws, and reports which model won', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary model overloaded'))
      .mockResolvedValueOnce('fallback result')
    const outcome = await callWithModelFallback('strong-model', fn)
    expect(outcome).toEqual({
      result: 'fallback result',
      modelUsed: FALLBACK_MODEL,
      usedFallback: true,
    })
    expect(fn).toHaveBeenNthCalledWith(1, 'strong-model')
    expect(fn).toHaveBeenNthCalledWith(2, FALLBACK_MODEL)
  })

  it('propagates the fallback attempt error (not the original) when both calls fail', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockRejectedValueOnce(new Error('fallback also failed'))
    await expect(callWithModelFallback('strong-model', fn)).rejects.toThrow(
      'fallback also failed',
    )
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('never calls the same model twice when the primary model already is the fallback model', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('the only model failed'))
    await expect(
      callWithModelFallback(FALLBACK_MODEL, fn),
    ).rejects.toThrow('the only model failed')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
