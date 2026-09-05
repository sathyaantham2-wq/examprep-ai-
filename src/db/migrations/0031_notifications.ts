import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('notifications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('channel', 'text', (col) =>
      col.notNull().check(sql`channel in ('email', 'whatsapp', 'in_app')`),
    )
    .addColumn('template', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb')
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('queued')
        .check(sql`status in ('queued', 'sent', 'failed', 'read')`),
    )
    .addColumn('sent_at', 'timestamptz')
    .addColumn('read_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('notifications').execute()
}
