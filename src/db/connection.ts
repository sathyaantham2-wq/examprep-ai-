import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { DB } from './types'
import { env } from '../lib/env'

export type Db = Kysely<DB>

// node-postgres emits 'error' on the Pool itself when an already-checked-out-but-idle client's
// connection drops (a network hiccup, or the DB server closing an idle connection) -- with zero
// listeners, Node's EventEmitter throws that as an uncaught exception and kills the whole
// process. Neither Kysely's PostgresDialect nor better-auth's pg adapter attaches one, so every
// pool this app creates needs its own. This one fix plausibly explains a large share of this
// project's "Worker exited unexpectedly" vitest crashes (see memory note
// examprep-test-suite-orphan-data) during long test runs, independent of the connection-count
// issue below.
function attachErrorHandler(pool: Pool): Pool {
  pool.on('error', (err) => {
    console.error('pg.Pool: idle client error (connection dropped, not fatal to the app)', err)
  })
  return pool
}

// F108's load-test harness found that calling createDb() once per HTTP request -- each opening
// its own pg.Pool -- blows past Supabase's session-mode pooler limit (15 concurrent connections
// for the whole project) at just 8-20 concurrent requests, failing with a raw EMAXCONNSESSION
// driver error instead of a graceful response. getSharedDb() below is the fix for route handlers:
// one long-lived pool, reused for the process's whole life. createDb() itself is kept for tests
// and standalone scripts (src/db/test-helpers.ts, scripts/*.ts, db:seed/db:migrate), which each
// need their own independent pool lifecycle (started and destroyed per test file or script run) --
// its pool size is capped modestly since several of these can be alive briefly at once.
export function createDb(): Db {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: attachErrorHandler(new Pool({ connectionString: env.DATABASE_URL, max: 4 })),
    }),
  })
}

let sharedDb: Db | null = null

/**
 * The app's own long-lived connection pool, used by real HTTP route handlers instead of each
 * calling createDb() per request. Created lazily on first use and never destroyed -- there is no
 * per-request `finally { await db.destroy() }` for this one; the pool outlives any single
 * request and is meant to.
 */
export function getSharedDb(): Db {
  sharedDb ??= new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: attachErrorHandler(new Pool({ connectionString: env.DATABASE_URL, max: 8 })),
    }),
  })
  return sharedDb
}
