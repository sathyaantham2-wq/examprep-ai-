import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeText,
  resolveProvider,
  resolveProviderChain,
  stripCodeFence,
} from './ai-provider'

describe('resolveProvider', () => {
  it('is null with no keys', () => {
    expect(resolveProvider({})).toBeNull()
  })

  it('uses whichever single key exists', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'a' })).toBe('anthropic')
    expect(resolveProvider({ GEMINI_API_KEY: 'g' })).toBe('gemini')
  })

  it('prefers Anthropic when both keys exist and nothing is forced', () => {
    expect(
      resolveProvider({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }),
    ).toBe('anthropic')
  })

  it('honours AI_PROVIDER when both keys exist', () => {
    expect(
      resolveProvider({
        AI_PROVIDER: 'gemini',
        ANTHROPIC_API_KEY: 'a',
        GEMINI_API_KEY: 'g',
      }),
    ).toBe('gemini')
    expect(
      resolveProvider({
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'a',
        GEMINI_API_KEY: 'g',
      }),
    ).toBe('anthropic')
  })

  it('does not silently switch vendor when the forced one has no key', () => {
    expect(
      resolveProvider({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a' }),
    ).toBeNull()
    expect(
      resolveProvider({ AI_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g' }),
    ).toBeNull()
  })
})

describe('resolveProviderChain (2026-09-24: side-by-side vendors, automatic fallover)', () => {
  it('is empty with no keys', () => {
    expect(resolveProviderChain({})).toEqual([])
  })

  it('orders every configured vendor by priority -- groq/cerebras first, gemini last', () => {
    expect(
      resolveProviderChain({
        GEMINI_API_KEY: 'g',
        ANTHROPIC_API_KEY: 'a',
        GROQ_API_KEY: 'q',
        CEREBRAS_API_KEY: 'c',
        OPENROUTER_API_KEY: 'o',
      }),
    ).toEqual(['groq', 'cerebras', 'anthropic', 'openrouter', 'gemini'])
  })

  it('skips any vendor with no key, keeping the rest in priority order', () => {
    expect(
      resolveProviderChain({ CEREBRAS_API_KEY: 'c', GEMINI_API_KEY: 'g' }),
    ).toEqual(['cerebras', 'gemini'])
  })

  it('AI_PROVIDER forces a chain of exactly one vendor', () => {
    expect(
      resolveProviderChain({
        AI_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'o',
        GROQ_API_KEY: 'q',
      }),
    ).toEqual(['openrouter'])
  })

  it('AI_PROVIDER forcing an unconfigured vendor yields an empty chain, never a substitute', () => {
    expect(
      resolveProviderChain({ AI_PROVIDER: 'cerebras', GROQ_API_KEY: 'q' }),
    ).toEqual([])
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('calls the Gemini endpoint with the key in a header and JSON mode on', async () => {
    const fetchMock = stubFetch({
      candidates: [{ content: { parts: [{ text: '{"ok": true}' }] } }],
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 7,
      },
    })
    const result = await completeText(
      { model: 'gemini-2.5-flash', prompt: 'hello', maxTokens: 100 },
      'gemini',
      { GEMINI_API_KEY: 'secret-key' },
    )
    expect(result).toEqual({
      text: '{"ok": true}',
      tokensIn: 11,
      tokensOut: 12,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    )
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'secret-key',
    )
    expect(url).not.toContain('secret-key')
    const sent = JSON.parse(init.body as string)
    expect(sent.contents[0].parts[0].text).toBe('hello')
    expect(sent.generationConfig.responseMimeType).toBe('application/json')
    // 2026-09-24: thinking disabled (see ai-provider.ts's own comment on why) -- maxOutputTokens
    // no longer needs headroom for a reasoning budget the model won't spend.
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(sent.generationConfig.maxOutputTokens).toBe(100)
  })

  it('sends photos to Gemini as inline data ahead of the prompt', async () => {
    const fetchMock = stubFetch({
      candidates: [{ content: { parts: [{ text: '{}' }] } }],
    })
    await completeText(
      {
        model: 'm',
        prompt: 'read this',
        maxTokens: 10,
        images: [{ mediaType: 'image/png', base64: 'AAAA' }],
      },
      'gemini',
      { GEMINI_API_KEY: 'k' },
    )
    const sent = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    )
    expect(sent.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { text: 'read this' },
    ])
  })

  it('skips reasoning parts and strips a code fence', async () => {
    stubFetch({
      candidates: [
        {
          content: {
            parts: [
              { text: 'thinking...', thought: true },
              { text: '```json\n{"a":1}\n```' },
            ],
          },
        },
      ],
    })
    const result = await completeText(
      { model: 'm', prompt: 'p', maxTokens: 10 },
      'gemini',
      { GEMINI_API_KEY: 'k' },
    )
    expect(result.text).toBe('{"a":1}')
  })

  it('returns null text when the prompt was blocked or the answer is empty', async () => {
    stubFetch({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })
    const blocked = await completeText(
      { model: 'm', prompt: 'p', maxTokens: 10 },
      'gemini',
      { GEMINI_API_KEY: 'k' },
    )
    expect(blocked.text).toBeNull()
    stubFetch({ candidates: [{ content: { parts: [] } }] })
    const empty = await completeText(
      { model: 'm', prompt: 'p', maxTokens: 10 },
      'gemini',
      { GEMINI_API_KEY: 'k' },
    )
    expect(empty.text).toBeNull()
  })

  it('throws with the status on an API error such as a rate limit', async () => {
    stubFetch('{"error":{"message":"quota exceeded"}}', 429)
    await expect(
      completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, 'gemini', {
        GEMINI_API_KEY: 'k',
      }),
    ).rejects.toThrow(/Gemini API 429/)
  })

  it('refuses to run when no matching key is configured', async () => {
    await expect(
      completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, 'gemini', {}),
    ).rejects.toThrow(/No AI provider/)
    await expect(
      completeText({ model: 'm', prompt: 'p', maxTokens: 10 }, null, {}),
    ).rejects.toThrow(/No AI provider/)
  })
})

// 2026-09-24: Groq, Cerebras and OpenRouter all share completeOpenAiCompatible -- one set of
// shape tests per vendor (base URL, auth header, model/response_format passthrough) rather than
// re-testing the shared parsing logic three times.
describe('completeText with OpenAI-compatible vendors (Groq, Cerebras, OpenRouter)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(body: unknown, status = 200) {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const cases: Array<{
    provider: 'groq' | 'cerebras' | 'openrouter'
    config: Record<string, string>
    baseUrl: string
  }> = [
    {
      provider: 'groq',
      config: { GROQ_API_KEY: 'secret-key' },
      baseUrl: 'https://api.groq.com/openai/v1',
    },
    {
      provider: 'cerebras',
      config: { CEREBRAS_API_KEY: 'secret-key' },
      baseUrl: 'https://api.cerebras.ai/v1',
    },
    {
      provider: 'openrouter',
      config: { OPENROUTER_API_KEY: 'secret-key' },
      baseUrl: 'https://openrouter.ai/api/v1',
    },
  ]

  for (const { provider, config, baseUrl } of cases) {
    it(`${provider}: posts to its chat/completions endpoint with a Bearer key and JSON mode on`, async () => {
      const fetchMock = stubFetch({
        choices: [{ message: { content: '{"ok": true}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 5 },
      })
      const result = await completeText(
        { model: 'a-model', prompt: 'hello', maxTokens: 100 },
        provider,
        config,
      )
      expect(result).toEqual({
        text: '{"ok": true}',
        tokensIn: 11,
        tokensOut: 5,
      })

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${baseUrl}/chat/completions`)
      expect((init.headers as Record<string, string>).authorization).toBe(
        'Bearer secret-key',
      )
      expect(url).not.toContain('secret-key')
      const sent = JSON.parse(init.body as string)
      expect(sent.model).toBe('a-model')
      expect(sent.messages).toEqual([{ role: 'user', content: 'hello' }])
      expect(sent.max_tokens).toBe(100)
      expect(sent.response_format).toEqual({ type: 'json_object' })
    })

    it(`${provider}: sends a photo as an image_url content part alongside the prompt text`, async () => {
      const fetchMock = stubFetch({ choices: [{ message: { content: '{}' } }] })
      await completeText(
        {
          model: 'm',
          prompt: 'read this',
          maxTokens: 10,
          images: [{ mediaType: 'image/png', base64: 'AAAA' }],
        },
        provider,
        config,
      )
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      )
      expect(sent.messages).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AAAA' },
            },
            { type: 'text', text: 'read this' },
          ],
        },
      ])
    })

    it(`${provider}: throws with the status on an API error`, async () => {
      stubFetch('{"error":"rate limited"}', 429)
      await expect(
        completeText(
          { model: 'm', prompt: 'p', maxTokens: 10 },
          provider,
          config,
        ),
      ).rejects.toThrow(`${baseUrl} 429`)
    })
  }
})
