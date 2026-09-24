import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { env } from '../../../lib/env'
import { resolveProviderChain, completeText } from '../../../lib/ai-provider'
import type { AiProvider } from '../../../lib/ai-provider'
import { fallbackModel, modelForFeature } from '../../../lib/ai-models'
import { wrapRouteHandlers } from '../../../lib/error-log'

// Admin-only. GET says which AI vendors are configured, in fallback priority order, and which
// models each maps to (never a key). POST makes one tiny real call PER configured vendor -- not
// just the first -- so a newly added key can be checked without waiting for it to be the one that
// happens to get tried on a real student's request.
export const Route = createFileRoute('/api/admin/ai-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const chain = resolveProviderChain()
        return Response.json({
          chain,
          keys_set: {
            anthropic: Boolean(env.ANTHROPIC_API_KEY),
            gemini: Boolean(env.GEMINI_API_KEY),
            groq: Boolean(env.GROQ_API_KEY),
            cerebras: Boolean(env.CEREBRAS_API_KEY),
            openrouter: Boolean(env.OPENROUTER_API_KEY),
          },
          forced: env.AI_PROVIDER ?? null,
          models: Object.fromEntries(
            chain.map((provider) => [
              provider,
              {
                strong: modelForFeature('AI-05', provider),
                cheap: fallbackModel(provider),
              },
            ]),
          ),
        })
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const chain = resolveProviderChain()
        if (chain.length === 0) {
          return Response.json({
            ok: false,
            error: 'No AI key is set for this deployment.',
          })
        }
        const results = await Promise.all(
          chain.map((provider) => probe(provider)),
        )
        return Response.json({ ok: results.some((r) => r.ok), results })
      },
    },
  },
})

async function probe(provider: AiProvider) {
  const model = fallbackModel(provider)
  const startedAt = Date.now()
  try {
    const result = await completeText(
      {
        model,
        prompt: 'Reply with only this JSON: {"ok": true}',
        maxTokens: 20,
      },
      provider,
    )
    return {
      ok: result.text !== null,
      provider,
      model,
      latency_ms: Date.now() - startedAt,
      error: result.text === null ? 'The model returned no text.' : null,
    }
  } catch (error) {
    return {
      ok: false,
      provider,
      model,
      latency_ms: Date.now() - startedAt,
      error:
        error instanceof Error
          ? error.message.slice(0, 300)
          : 'The call failed.',
    }
  }
}

wrapRouteHandlers(Route, '/api/admin/ai-status', ['GET', 'POST'])
