import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('attempt_answers')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('attempt_id', 'uuid', (col) =>
      col.notNull().references('attempts.id').onDelete('cascade'),
    )
    .addColumn('paper_question_id', 'uuid', (col) =>
      col.notNull().references('paper_questions.id').onDelete('restrict'),
    )
    .addColumn('response_text', 'text')
    .addColumn('selected_option', 'text')
    .addColumn('time_spent_sec', 'integer')
    .addColumn('source', 'text', (col) =>
      col.notNull().check(sql`source in ('typed', 'ocr')`),
    )
    .addColumn('ocr_confidence', sql`numeric(4, 3)`)
    .addColumn('image_ref', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('attempt_answers_attempt_question_key', [
      'attempt_id',
      'paper_question_id',
    ])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('attempt_answers').execute()
}
