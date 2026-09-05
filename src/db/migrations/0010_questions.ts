import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('questions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('concept_id', 'uuid', (col) =>
      col.notNull().references('concepts.id').onDelete('cascade'),
    )
    .addColumn('board', 'text', (col) => col.notNull())
    .addColumn('class', 'integer', (col) =>
      col.notNull().check(sql`class between 1 and 12`),
    )
    .addColumn('bloom', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`bloom in ('Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create')`,
        ),
    )
    .addColumn('difficulty', 'text', (col) =>
      col.notNull().check(sql`difficulty in ('Easy', 'Hard', 'Hardest')`),
    )
    .addColumn('marks', 'integer', (col) => col.notNull().check(sql`marks > 0`))
    .addColumn('type', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`type in ('mcq', 'assertion_reason', 'match', 'multi_statement', 'short_answer', 'long_answer', 'fill_blank', 'diagram')`,
        ),
    )
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('answer', 'text', (col) => col.notNull())
    .addColumn('hint', 'text')
    .addColumn('tags', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .addColumn('diagram_kind', 'text')
    .addColumn('diagram_params', 'jsonb')
    .addColumn('language', 'text', (col) => col.notNull().defaultTo('English'))
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('draft')
        .check(sql`status in ('draft', 'approved', 'retired')`),
    )
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('source_ref', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('questions_concept_bloom_difficulty_idx')
    .on('questions')
    .columns(['concept_id', 'bloom', 'difficulty'])
    .where(sql.ref('status'), '=', 'approved')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('questions').execute()
}
