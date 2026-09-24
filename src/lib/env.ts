import { z } from 'zod'

// F002: every env var actually read anywhere in this codebase, in one place, validated once at
// startup instead of trusting whatever `process.env.X` happens to return at the point of use.
// Google and Anthropic are optional here because src/lib/auth.ts and src/lib/ai-grading.ts are
// designed to degrade gracefully without them (Google sign-in skipped, AI grading falls back to
// "needs manual marking") — but DATABASE_URL and the better-auth vars are load-bearing for
// everything in this app, so a missing one fails loudly and immediately, not on first use deep
// inside a request handler.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // 2026-09-24, user request: several AI vendors side by side, tried in a fixed priority order
  // (src/lib/ai-provider.ts's PROVIDER_PRIORITY) with automatic fallover to the next configured
  // one on any failure -- not just one vendor at a time. AI_PROVIDER, if set, forces exactly one
  // (and only that one) instead of the chain. Groq/Cerebras/OpenRouter are all OpenAI-compatible
  // chat-completions APIs, so they share one implementation (completeOpenAiCompatible).
  GEMINI_API_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  CEREBRAS_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  AI_PROVIDER: z
    .enum(['anthropic', 'gemini', 'groq', 'cerebras', 'openrouter'])
    .optional(),
  GEMINI_MODEL_STRONG: z.string().min(1).optional(),
  GEMINI_MODEL_CHEAP: z.string().min(1).optional(),
  GROQ_MODEL_STRONG: z.string().min(1).optional(),
  GROQ_MODEL_CHEAP: z.string().min(1).optional(),
  CEREBRAS_MODEL_STRONG: z.string().min(1).optional(),
  CEREBRAS_MODEL_CHEAP: z.string().min(1).optional(),
  OPENROUTER_MODEL_STRONG: z.string().min(1).optional(),
  OPENROUTER_MODEL_CHEAP: z.string().min(1).optional(),
  // Every vendor here except Anthropic has a real free tier; each defaults to 0 cost the same way
  // Gemini already did, and only needs a real per-1M-token USD price set if that vendor's plan
  // actually charges (F121 spend caps).
  GEMINI_USD_PER_1M_INPUT: z.coerce.number().nonnegative().optional(),
  GEMINI_USD_PER_1M_OUTPUT: z.coerce.number().nonnegative().optional(),
  GROQ_USD_PER_1M_INPUT: z.coerce.number().nonnegative().optional(),
  GROQ_USD_PER_1M_OUTPUT: z.coerce.number().nonnegative().optional(),
  CEREBRAS_USD_PER_1M_INPUT: z.coerce.number().nonnegative().optional(),
  CEREBRAS_USD_PER_1M_OUTPUT: z.coerce.number().nonnegative().optional(),
  OPENROUTER_USD_PER_1M_INPUT: z.coerce.number().nonnegative().optional(),
  OPENROUTER_USD_PER_1M_OUTPUT: z.coerce.number().nonnegative().optional(),
  // F080: a Make.com webhook (Custom Webhook -> Gmail "Send an email") -- see src/lib/email.ts.
  // Optional, same graceful-degradation shape as ANTHROPIC_API_KEY: without it, transactional
  // email is simply not sent (logged as 'failed' with a reason), never a startup failure.
  MAKE_EMAIL_WEBHOOK_URL: z.string().url().optional(),
  // F080: authenticates GET /api/cron/weekly-summary -- Vercel Cron sends this as a Bearer
  // token on every scheduled invocation so the route can't be triggered by anyone else who
  // finds the URL. Optional so local dev (no Vercel Cron) doesn't need it set; the route
  // refuses to run without it configured in a real deployment (never silently skips the check).
  CRON_SECRET: z.string().min(1).optional(),
  // F004: "release tagging" for the self-hosted error log (src/lib/error-log.ts) -- Vercel sets
  // this automatically on every deployment, so it needs no configuration of its own; null in
  // local dev, where "which deploy" doesn't apply anyway.
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).optional(),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  // A blank line in .env (KEY=) means "not set", not an invalid empty value.
  const present = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== ''),
  )
  const parsed = envSchema.safeParse(present)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    console.error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the missing values.`,
    )
    throw new Error(
      'Invalid environment configuration — see the messages above.',
    )
  }
  return parsed.data
}

export const env = loadEnv()
