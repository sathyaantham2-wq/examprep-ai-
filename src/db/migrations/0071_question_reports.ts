import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F129: "Report a problem" on a question. A student can say, in one or two lines, that her answer
// was marked wrong but is right (typically a spelling-only difference on a fill-in-the-blank),
// that the question or its answer key has a mistake, or that it is unclear. A report never
// changes a mark by itself -- it is feedback an admin/parent reviews, and the question itself is
// only ever retired through the normal question-bank flow (nothing is deleted). Status moves
// open -> resolved/dismissed; rows are kept either way so the history stays auditable.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('question_reports')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('question_id', 'uuid', (col) =>
      col.notNull().references('questions.id'),
    )
    .addColumn('paper_question_id', 'uuid', (col) =>
      col.notNull().references('paper_questions.id').onDelete('cascade'),
    )
    .addColumn('attempt_id', 'uuid', (col) =>
      col.notNull().references('attempts.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('households.id').onDelete('cascade'),
    )
    .addColumn('reason', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`reason in ('marked_wrong', 'question_error', 'answer_error', 'unclear', 'other')`,
        ),
    )
    .addColumn('comment', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('open')
        .check(sql`status in ('open', 'resolved', 'dismissed')`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('resolved_at', 'timestamptz')
    // One report per question per attempt -- enough to be heard, not a spam channel.
    .addUniqueConstraint('question_reports_attempt_question_key', [
      'attempt_id',
      'paper_question_id',
    ])
    .execute()

  await db.schema
    .createIndex('question_reports_status_idx')
    .on('question_reports')
    .columns(['status', 'created_at'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('question_reports').execute()
}
