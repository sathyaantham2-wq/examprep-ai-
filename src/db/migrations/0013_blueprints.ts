import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('blueprints')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('subject_id', 'uuid', (col) =>
      col.notNull().references('subjects.id').onDelete('cascade'),
    )
    .addColumn('board', 'text', (col) => col.notNull())
    .addColumn('class', 'integer', (col) =>
      col.notNull().check(sql`class between 1 and 12`),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('total_marks', 'integer', (col) =>
      col.notNull().check(sql`total_marks > 0`),
    )
    .addColumn('duration_min', 'integer', (col) =>
      col.notNull().check(sql`duration_min > 0`),
    )
    .addColumn('sections', 'jsonb', (col) => col.notNull())
    .addColumn('bloom_targets', 'jsonb', (col) => col.notNull())
    .addColumn('choice_rules', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('blueprints').execute()
}
