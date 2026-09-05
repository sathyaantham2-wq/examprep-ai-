import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('pattern_hits')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('evaluation_item_id', 'uuid', (col) =>
      col.notNull().references('evaluation_items.id').onDelete('cascade'),
    )
    .addColumn('pattern_id', 'uuid', (col) =>
      col.notNull().references('patterns.id').onDelete('restrict'),
    )
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('pattern_hits').execute()
}
