import { Pool } from 'pg'

// better-auth manages its own tables (sessions, accounts, verifications) through its own adapter
// and needs a raw pg Pool, separate from the Kysely instance in connection.ts. Kept in src/db/ so
// src/lib/auth.ts doesn't need its own `pg` import, which the eslint no-restricted-imports rule
// only allows inside this directory.
export function createAuthPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL })
}
