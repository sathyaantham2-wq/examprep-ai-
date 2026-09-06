import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { DB } from './types'
import { env } from '../lib/env'

export type Db = Kysely<DB>

export function createDb(): Db {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: env.DATABASE_URL }),
    }),
  })
}
