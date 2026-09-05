import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in.',
    )
  }
  return url
}

export function createDb<T = any>(): Kysely<T> {
  return new Kysely<T>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: requireDatabaseUrl() }),
    }),
  })
}
