import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('paper_questions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('paper_id', 'uuid', (col) =>
      col.notNull().references('papers.id').onDelete('cascade'),
    )
    .addColumn('question_id', 'uuid', (col) =>
      col.notNull().references('questions.id').onDelete('restrict'),
    )
    .addColumn('section', 'text', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('marks', 'integer', (col) => col.notNull().check(sql`marks > 0`))
    // Questions sharing a choice_group are "attempt any N of these" — the pair/group presented
    // together on the paper.
    .addColumn('choice_group', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('paper_questions').execute()
}
