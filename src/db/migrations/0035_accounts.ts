import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// better-auth's account table (src/lib/auth.ts: account.modelName = 'accounts') — one row per
// sign-in method linked to a user: a 'credential' row holding the hashed password for
// email+password, and one row per OAuth provider (e.g. 'google').
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('accounts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('issuer', 'text', (col) => col.notNull())
    .addColumn('account_id', 'text', (col) => col.notNull())
    .addColumn('provider_id', 'text', (col) => col.notNull())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('access_token', 'text')
    .addColumn('refresh_token', 'text')
    .addColumn('id_token', 'text')
    .addColumn('access_token_expires_at', 'timestamptz')
    .addColumn('refresh_token_expires_at', 'timestamptz')
    .addColumn('scope', 'text')
    .addColumn('password', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('accounts_user_id_idx')
    .on('accounts')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('accounts_issuer_account_id_uidx')
    .on('accounts')
    .columns(['issuer', 'account_id'])
    .unique()
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('accounts').execute()
}
