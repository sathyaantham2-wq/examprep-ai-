import { existsSync } from 'node:fs'
import { config } from 'dotenv'

// Tests load .env.test when it exists, falling back to .env otherwise. Keeping the test database
// in its own file (git-ignored, same as .env) is what makes the guard below possible at all --
// before this, `npm test` read .env, which on a developer machine points at the SAME Supabase
// project that serves real users.
const testEnvPath = '.env.test'
if (existsSync(testEnvPath)) {
  config({ path: testEnvPath, override: true })
} else {
  config()
}

/**
 * Hard stop: the integration suite creates, mutates and DELETES rows (fixture subjects, concepts,
 * questions, households, attempts) and several files clean up with broad `deleteFrom(...)` calls.
 * Pointed at a production database that is data loss, and pointed at a *shared* one it is worse
 * than flaky -- on 2026-09-22 a crashed run left an "Adaptive fixture subject" row active and a
 * real student saw it in her own subject list, twice.
 *
 * CI already runs against an ephemeral `postgres:17` service container on localhost, so it passes
 * this check unchanged. There is deliberately no override flag: "just this once against the real
 * database" is exactly the decision that caused the incident.
 */
const url = process.env.DATABASE_URL
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.test.example to .env.test and point it at your local Postgres.',
  )
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'postgres', 'db'])
let host: string
try {
  host = new URL(url).hostname.replace(/^\[|\]$/g, '')
} catch {
  throw new Error(`DATABASE_URL is not a valid URL: ${url}`)
}

if (!LOCAL_HOSTS.has(host)) {
  throw new Error(
    [
      '',
      '================================ REFUSING TO RUN TESTS ================================',
      `  DATABASE_URL points at a non-local host: ${host}`,
      '',
      '  This suite writes and deletes fixture rows, so it must never run against a remote',
      '  (production or shared) database. Set up a local one instead:',
      '',
      '    1. Install Postgres 17 locally (or run one in Docker).',
      '    2. Copy .env.test.example to .env.test and set DATABASE_URL to that local database.',
      '    3. npm run db:setup:test      # migrate + seed the local test database',
      '',
      '  Allowed hosts: ' + [...LOCAL_HOSTS].join(', '),
      '=======================================================================================',
      '',
    ].join('\n'),
  )
}
