import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('question_usage')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('question_id', 'uuid', (col) =>
      col.notNull().references('questions.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('served_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('paper_id', 'uuid', (col) =>
      col.notNull().references('papers.id').onDelete('cascade'),
    )
    .addColumn('was_correct', 'boolean')
    .execute()

  await db.schema
    .createIndex('question_usage_student_question_idx')
    .on('question_usage')
    .columns(['student_id', 'question_id'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('question_usage').execute()
}
