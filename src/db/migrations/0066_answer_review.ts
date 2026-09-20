import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// A student can question the AI's mark on a written answer once (answer_disputes, one row per
// item, append-only) and, if still unhappy, take that question out of her grade. A removed
// question is only flagged, never deleted: it is skipped when marks and mastery are worked out.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('evaluation_items')
    .addColumn('excluded_by_student', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()
  await db.schema.alterTable('evaluation_items').addColumn('excluded_at', 'timestamptz').execute()

  await db.schema
    .createTable('answer_disputes')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('evaluation_item_id', 'uuid', (col) =>
      col.notNull().references('evaluation_items.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) => col.notNull().references('students.id').onDelete('cascade'))
    .addColumn('student_comment', 'text', (col) => col.notNull())
    .addColumn('ai_reply', 'text', (col) => col.notNull())
    .addColumn('marks_before', 'numeric', (col) => col.notNull())
    .addColumn('marks_after', 'numeric', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // One AI re-review per answer: after it the student either accepts or removes the question.
    .addUniqueConstraint('answer_disputes_item_key', ['evaluation_item_id'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('answer_disputes').execute()
  await db.schema.alterTable('evaluation_items').dropColumn('excluded_at').execute()
  await db.schema.alterTable('evaluation_items').dropColumn('excluded_by_student').execute()
}
