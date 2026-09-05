import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('evaluation_items')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('evaluation_id', 'uuid', (col) =>
      col.notNull().references('evaluations.id').onDelete('cascade'),
    )
    .addColumn('paper_question_id', 'uuid', (col) =>
      col.notNull().references('paper_questions.id').onDelete('restrict'),
    )
    .addColumn('marks_awarded', 'numeric', (col) => col.notNull())
    .addColumn('marks_max', 'numeric', (col) => col.notNull())
    .addColumn('ai_marks', 'numeric')
    .addColumn('error_type', 'text')
    .addColumn('knowledge_known', 'boolean')
    .addColumn('feedback', 'text')
    .addColumn('step_marks_awarded', 'jsonb')
    .addColumn('overridden_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('evaluation_items').execute()
}
