import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// Append-only ledger (CLAUDE.md invariant 4) — no updates, no deletes, ever. Rows are only ever
// inserted, by a confirmed evaluation.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('concept_mastery')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('concept_id', 'uuid', (col) =>
      col.notNull().references('concepts.id').onDelete('cascade'),
    )
    .addColumn('evaluation_id', 'uuid', (col) =>
      col.notNull().references('evaluations.id').onDelete('cascade'),
    )
    .addColumn('date', 'date', (col) => col.notNull())
    .addColumn('marks', 'numeric', (col) => col.notNull())
    .addColumn('marks_max', 'numeric', (col) => col.notNull())
    .addColumn('ratio', 'numeric', (col) => col.notNull())
    .addColumn('status_at_time', 'text')
    .execute()

  await db.schema
    .createIndex('concept_mastery_student_concept_date_idx')
    .on('concept_mastery')
    .columns(['student_id', 'concept_id', 'date'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('concept_mastery').execute()
}
