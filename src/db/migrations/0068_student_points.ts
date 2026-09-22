import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F125 (first slice: schema + points logic; UI/leaderboard screen is a later pass). Append-only
// ledger (CLAUDE.md invariant 4) -- one row per correctly-answered objective (MCQ-family) item,
// written only from confirmEvaluation() once marks are actually confirmed, never before: points
// are a reward derived FROM a confirmed mark, so they follow the exact same human/auto-confirm
// gate CLAUDE.md's "AI never finalises a mark on a normal paper" rule already puts marks through
// -- an adaptive paper's MCQs are confirmed at submit (F119), a normal paper's wait for a parent,
// and points follow whichever gate actually applies. evaluation_item_id is UNIQUE so a retried
// confirm can never double-award the same item.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('students')
    .addColumn('leaderboard_opt_in', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('leaderboard_nickname', 'text')
    .execute()

  await db.schema
    .createTable('student_points_ledger')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('evaluation_item_id', 'uuid', (col) =>
      col.notNull().unique().references('evaluation_items.id').onDelete('cascade'),
    )
    .addColumn('concept_id', 'uuid', (col) =>
      col.notNull().references('concepts.id').onDelete('cascade'),
    )
    .addColumn('difficulty', 'text', (col) =>
      col.notNull().check(sql`difficulty in ('Easy', 'Hard', 'Hardest')`),
    )
    .addColumn('points', 'integer', (col) => col.notNull())
    .addColumn('coins', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // Leaderboard aggregation (next pass) groups by student within a board+class+subject cohort --
  // this is the index that query will actually use.
  await db.schema
    .createIndex('student_points_ledger_student_idx')
    .on('student_points_ledger')
    .columns(['student_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('student_points_ledger').execute()
  await db.schema
    .alterTable('students')
    .dropColumn('leaderboard_opt_in')
    .dropColumn('leaderboard_nickname')
    .execute()
}
