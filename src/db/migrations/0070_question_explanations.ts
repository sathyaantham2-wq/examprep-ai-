import type { Kysely } from 'kysely'

// F126 / tab07 AI-13: a worked explanation of why a question's correct answer is correct, shown
// on the student's own result screen after her marks are confirmed (the T09 amendment of
// 2026-09-22 is what makes showing it allowable at all).
//
// One row per QUESTION, not per student and not per attempt: the explanation of "why 3/4 > 2/3"
// does not vary by who got it wrong, so it is generated once and reused by every student who
// ever sees that question -- the same caching decision F067 made for per-concept remediation
// content (migration 0046), and the reason a bank of ~8,000 approved MCQs is affordable to
// explain at all. Generation is lazy: a row appears the first time some student actually asks
// for that question's explanation, never as a bulk backfill of questions nobody reviews.
//
// `source` records how the row was produced: 'ai' (AI-13 wrote it) or 'step_marks' (derived for
// free from the question's existing question_step_marks rows, which already read as a worked
// solution for the ~3,900 written questions that have them). Nothing here is ever deleted --
// CLAUDE.md invariant 4 -- so a regenerated explanation replaces the text in place and bumps
// updated_at rather than inserting a competing row.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('question_explanations')
    .addColumn('question_id', 'uuid', (col) =>
      col.primaryKey().references('questions.id').onDelete('cascade'),
    )
    .addColumn('explanation', 'text', (col) => col.notNull())
    .addColumn('source', 'varchar(20)', (col) => col.notNull())
    .addColumn('model', 'varchar(80)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('question_explanations').execute()
}
