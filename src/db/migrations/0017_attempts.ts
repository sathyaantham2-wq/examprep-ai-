import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('attempts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('paper_id', 'uuid', (col) =>
      col.notNull().references('papers.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('mode', 'text', (col) =>
      col.notNull().check(sql`mode in ('online', 'uploaded')`),
    )
    .addColumn('started_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('submitted_at', 'timestamptz')
    .addColumn('duration_used_sec', 'integer')
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('in_progress')
        .check(sql`status in ('in_progress', 'submitted', 'evaluated')`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('attempts').execute()
}
