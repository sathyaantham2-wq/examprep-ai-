import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { env } from '../../../lib/env'
import { activeProvider, completeText } from '../../../lib/ai-provider'
import { fallbackModel, modelForFeature } from '../../../lib/ai-models'
import { wrapRouteHandlers } from '../../../lib/error-log'

// Admin-only. GET says which AI vendor is in use and which models it maps to (never the key).
// POST makes one tiny real call so a newly added key can be checked without generating a paper.
export const Route = createFileRoute('/api/admin/ai-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const provider = activeProvider()
        return Response.json({
          provider,
          anthropic_key_set: Boolean(env.ANTHROPIC_API_KEY),
          gemini_key_set: Boolean(env.GEMINI_API_KEY),
          forced: env.AI_PROVIDER ?? null,
          models: provider
            ? { strong: modelForFeature('AI-05', provider), cheap: fallbackModel(provider) }
            : null,
        })
      },
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth
        const provider = activeProvider()
        if (!provider) {
          return Response.json({ ok: false, error: 'No AI key is set for this deployment.' })
        }
        const model = fallbackModel(provider)
        const startedAt = Date.now()
        try {
          const result = await completeText({
            model,
            prompt: 'Reply with only this JSON: {"ok": true}',
            maxTokens: 20,
          })
          return Response.json({
            ok: result.text !== null,
            provider,
            model,
            latency_ms: Date.now() - startedAt,
            error: result.text === null ? 'The model returned no text.' : null,
          })
        } catch (error) {
          return Response.json({
            ok: false,
            provider,
            model,
            error: error instanceof Error ? error.message.slice(0, 300) : 'The call failed.',
          })
        }
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/admin/ai-status', ['GET', 'POST'])
