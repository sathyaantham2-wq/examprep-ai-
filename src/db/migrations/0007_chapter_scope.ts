import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('chapter_scope')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('chapter_id', 'uuid', (col) =>
      col.notNull().references('chapters.id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (col) =>
      col.notNull().check(sql`kind in ('IN', 'OUT')`),
    )
    .addColumn('item_text', 'text', (col) => col.notNull())
    .addColumn('page_ref', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('chapter_scope').execute()
}
