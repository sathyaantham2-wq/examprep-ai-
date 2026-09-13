import { Pool } from 'pg'
import { env } from '../lib/env'

// better-auth manages its own tables (sessions, accounts, verifications) through its own adapter
// and needs a raw pg Pool, separate from the Kysely instance in connection.ts. Kept in src/db/ so
// src/lib/auth.ts doesn't need its own `pg` import, which the eslint no-restricted-imports rule
// only allows inside this directory. This pool is a module-level singleton (src/lib/auth.ts calls
// this once, not per-request) so it doesn't contribute to the per-request connection-exhaustion
// issue documented in connection.ts, but it needs the same 'error' listener that file's pools
// get -- see attachErrorHandler's comment there for why an idle-client drop with no listener
// crashes the whole process, and a conservative `max` since it runs alongside connection.ts's
// pools against the same Supabase session-pooler connection ceiling.
export function createAuthPool(): Pool {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 })
  pool.on('error', (err) => {
    console.error('pg.Pool (auth): idle client error (connection dropped, not fatal to the app)', err)
  })
  return pool
}
