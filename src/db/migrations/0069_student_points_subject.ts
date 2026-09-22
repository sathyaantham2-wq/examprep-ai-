import type { Kysely } from 'kysely'

// F125 (second slice: opt-in + leaderboard). The leaderboard cohort is "the same board, class and
// subject" -- CLAUDE.md invariant 2 says board/class are first-class columns everywhere, and here
// that requirement is already exactly what one subjects row represents (a subject is scoped to
// one board+class+code), so a single subject_id column is the whole cohort key, no separate
// board/class columns needed. Table has zero real rows yet (F125 slice 1 only just shipped), so
// NOT NULL needs no backfill.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('student_points_ledger')
    .addColumn('subject_id', 'uuid', (col) =>
      col.notNull().references('subjects.id').onDelete('cascade'),
    )
    .execute()

  await db.schema
    .createIndex('student_points_ledger_subject_idx')
    .on('student_points_ledger')
    .columns(['subject_id', 'student_id'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('student_points_ledger').dropColumn('subject_id').execute()
}
