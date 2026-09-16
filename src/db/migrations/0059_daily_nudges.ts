import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F082: "A single concrete action derived from the latest diagnosis, delivered once daily,
// marked done or skipped." One row per (student, date) -- the unique constraint is what makes
// the daily cron job idempotent and safe to re-run (F108/T22's own "top-up job" convention),
// same reasoning as study_plans' UNIQUE(student_id, week_start) (F077).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('daily_nudges')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('date', 'date', (col) => col.notNull())
    .addColumn('concept_id', 'uuid', (col) => col.references('concepts.id'))
    .addColumn('action_text', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending').check(sql`status in ('pending', 'done', 'skipped')`),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('daily_nudges_student_date_key', ['student_id', 'date'])
    .execute()

  await db.schema
    .createIndex('daily_nudges_student_date_idx')
    .on('daily_nudges')
    .columns(['student_id', 'date'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('daily_nudges').execute()
}
