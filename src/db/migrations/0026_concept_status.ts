import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// Current derived state per (student, concept) — mutable, unlike concept_mastery. Recomputed from
// the mastery ledger; safe to overwrite in place since it carries no history of its own.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('concept_status')
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('concept_id', 'uuid', (col) =>
      col.notNull().references('concepts.id').onDelete('cascade'),
    )
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('avg_ratio', 'numeric')
    .addColumn('last_ratio', 'numeric')
    .addColumn('trend', 'text')
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('Needs Practice')
        .check(
          sql`status in ('Strong', 'Needs Practice', 'Weak', 'Priority', 'Maintenance')`,
        ),
    )
    .addColumn('flagged_at', 'timestamptz')
    .addColumn('next_retest_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('concept_status_pkey', [
      'student_id',
      'concept_id',
    ])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('concept_status').execute()
}
