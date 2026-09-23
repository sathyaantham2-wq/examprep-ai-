import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

// Whatever env-loading nitro's dev server normally does for `npm run dev` doesn't seem to run
// the same way once the process is spawned as Playwright's webServer child -- load the env file
// directly here instead of relying on that, and pass it through explicitly.
//
// .env.test first, exactly as vitest.setup.ts does: these specs sign up real users, generate real
// papers and delete their own fixtures afterwards, so they are every bit as dangerous against the
// database that serves real students as the integration suite was until 2026-09-23. `npm test`
// was fixed that day; this file was the remaining way to aim the same kind of run at production.
if (existsSync('.env.test')) process.loadEnvFile('.env.test')
else if (existsSync('.env')) process.loadEnvFile('.env')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'postgres', 'db'])
const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.test.example to .env.test and point it at your local Postgres.',
  )
}
const dbHost = (() => {
  try {
    return new URL(dbUrl).hostname.replace(/^\[|\]$/g, '')
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${dbUrl}`)
  }
})()
if (!LOCAL_HOSTS.has(dbHost)) {
  throw new Error(
    `Refusing to run the E2E suite: DATABASE_URL points at a non-local host (${dbHost}). ` +
      'These specs create and delete fixture data. Set up .env.test (see .env.test.example) first.',
  )
}

// F104: "green before every deploy." Separate from the vitest suite -- this drives a real
// browser against a real running dev server and a real (local, per the guard above) database, so
// it's a slower, heavier gate than the unit/integration tests, run as its own CI stage
// (`npm run test:e2e`), not folded into `npm test`.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  // fullyParallel:false only serializes tests within one file -- separate spec files still ran as
  // separate workers by default, which raced two files' fixture setup against the same live dev
  // DB (one PATCH hit a row the other file's beforeAll hadn't committed yet, and left an orphaned
  // concept/questions behind when its own afterAll never ran). Same root cause vitest.config.ts
  // already documents for fileParallelism -- these E2E specs share one live DB, so they were never
  // safe to run as concurrent workers either.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    cwd: import.meta.dirname,
    env: process.env as Record<string, string>,
  },
})
