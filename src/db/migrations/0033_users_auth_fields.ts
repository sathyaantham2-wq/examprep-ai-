import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// better-auth requires these three columns on whatever table it's configured to treat as the
// user table (src/lib/auth.ts maps it onto our existing users table via modelName).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('email_verified', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('image', 'text')
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .dropColumn('email_verified')
    .dropColumn('image')
    .dropColumn('updated_at')
    .execute()
}
