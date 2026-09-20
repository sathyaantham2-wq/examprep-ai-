import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeText, resolveProvider, stripCodeFence } from './ai-provider'

describe('resolveProvider', () => {
  it('is null with no keys', () => {
    expect(resolveProvider({})).toBeNull()
  })

  it('uses whichever single key exists', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'a' })).toBe('anthropic')
    expect(resolveProvider({ GEMINI_API_KEY: 'g' })).toBe('gemini')
  })

  it('prefers Anthropic when both keys exist and nothing is forced', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toBe('anthropic')
  })

  it('honours AI_PROVIDER when both keys exist', () => {
    expect(resolveProvider({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toBe('gemini')
    expect(resolveProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toBe('anthropic')
  })

  it('does not silently switch vendor when the forced one has no key', () => {
    expect(resolveProvider({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a' })).toBeNull()
    expect(resolveProvider({ AI_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g' })).toBeNull()
  })
})

describe('stripCodeFence', () => {
  it('removes a json fence and leaves plain text alone', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripCodeFence('```\n[1,2]\n```')).toBe('[1,2]')
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}')
  })
})

describe('completeText with Gemini', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(body: unknown, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('calls the Gemini endpoint with the key in a header and JSON mode on', async () => {
    const fetchMock = stubFetch({
      candidates: [{ content: { parts: [{ text: '{"ok": true}' }] } }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
    })
    const result = await completeText(
      { model: 'gemini-2.5-flash', prompt: 'hello', maxTokens: 100 },
      'gemini',
      { GEMINI_API_KEY: 'secret-key' },
    )
    expect(result).toEqual({ text: '{"ok": true}', tokensIn: 11, tokensOut: 12 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    )
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    expect(url).not.toContain('secret-key')
    const sent = JSON.parse(init.body as string)
    expect(sent.contents[0].parts[0].text).toBe('hello')
    expect(sent.generationConfig.responseMimeType).toBe('application/json')
    expect(sent.generationConfig.maxOutputTokens).toBeGreaterThan(100)
  })

  it('skips reasoning parts and strips a code fence', async () => {
    stubFetch({
      candidates: [
        { content: { parts: [{ text: 'thinking...', thought: true }, { text: '```json\n{"a":1}\n```' }] } },
      ],
    })
    const result = await completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, 'gemini', { GEMINI_API_KEY: 'k' })
    expect(result.text).toBe('{"a":1}')
  })

  it('returns null text when the prompt was blocked or the answer is empty', async () => {
    stubFetch({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })
    const blocked = await completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, 'gemini', { GEMINI_API_KEY: 'k' })
    expect(blocked.text).toBeNull()
    stubFetch({ candidates: [{ content: { parts: [] } }] })
    const empty = await completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, 'gemini', { GEMINI_API_KEY: 'k' })
    expect(empty.text).toBeNull()
  })

  it('throws with the status on an API error such as a rate limit', async () => {
    stubFetch('{"error":{"message":"quota exceeded"}}', 429)
    await expect(
      completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, 'gemini', { GEMINI_API_KEY: 'k' }),
    ).rejects.toThrow(/Gemini API 429/)
  })

  it('refuses to run when no matching key is configured', async () => {
    await expect(completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, 'gemini', {})).rejects.toThrow(
      /No AI provider/,
    )
    await expect(completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, null, {})).rejects.toThrow(
      /No AI provider/,
    )
  })
})
