import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F004: "Sentry (or equivalent) capturing client + server errors with release tagging;
// request-scoped log IDs." No Sentry (or any error-tracking) account exists for this app -- this
// is the equivalent, self-hosted: one row per captured error, correlated by request_id (server)
// or a per-page-load id (client), tagged with the deployed commit (Vercel sets
// VERCEL_GIT_COMMIT_SHA automatically; null outside Vercel, e.g. local dev). household_id/user_id
// are nullable since most errors happen before or without a resolved session (a bad request, an
// expired cookie, a client error on a public page).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('error_log')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('request_id', 'uuid', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull().check(sql`source in ('server', 'client')`))
    .addColumn('route', 'text', (col) => col.notNull())
    .addColumn('method', 'text')
    .addColumn('status_code', 'integer')
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('stack', 'text')
    .addColumn('release', 'text')
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('household_id', 'uuid', (col) => col.references('households.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('error_log_created_at_idx')
    .on('error_log')
    .column('created_at')
    .execute()

  await db.schema
    .createIndex('error_log_request_id_idx')
    .on('error_log')
    .column('request_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('error_log').execute()
}
