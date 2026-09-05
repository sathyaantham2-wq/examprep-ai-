import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// better-auth's verification table (src/lib/auth.ts: verification.modelName = 'verifications') —
// short-lived tokens for email verification and password reset.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('verifications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('identifier', 'text', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('verifications_identifier_idx')
    .on('verifications')
    .column('identifier')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('verifications').execute()
}
