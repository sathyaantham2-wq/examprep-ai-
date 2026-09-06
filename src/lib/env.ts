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
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
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
