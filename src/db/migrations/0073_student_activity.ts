import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// Admin "student activity" page (2026-10-03 request): how many students use the web app and for
// how many minutes. Nothing recorded active time before this, so it starts here. One row per
// student per day (India time), holding only a running total of active seconds -- never what she
// looked at. The browser pings every 30 s while the tab is visible and she has just touched the
// screen; the server credits at most the real time since the previous ping, so the total can
// never exceed the wall clock however often a client pings.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('student_activity_daily')
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('day', 'date', (col) => col.notNull())
    .addColumn('active_seconds', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('pings', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('first_seen_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('last_seen_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('student_activity_daily_pkey', [
      'student_id',
      'day',
    ])
    .execute()

  await db.schema
    .createIndex('student_activity_daily_day_idx')
    .on('student_activity_daily')
    .column('day')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('student_activity_daily').execute()
}
