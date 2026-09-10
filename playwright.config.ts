import { defineConfig } from '@playwright/test'

// Whatever env-loading nitro's dev server normally does for `npm run dev` doesn't seem to run
// the same way once the process is spawned as Playwright's webServer child -- load .env directly
// here instead of relying on that, and pass it through explicitly.
process.loadEnvFile('.env')

// F104: "green before every deploy." Separate from the vitest suite -- this drives a real
// browser against a real running dev server and the real dev DB, so it's a slower, heavier gate
// than the unit/integration tests, run as its own CI stage (`npm run test:e2e`), not folded into
// `npm test`.
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
