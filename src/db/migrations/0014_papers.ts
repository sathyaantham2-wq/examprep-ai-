import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('papers')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('blueprint_id', 'uuid', (col) =>
      col.notNull().references('blueprints.id').onDelete('restrict'),
    )
    .addColumn('subject_id', 'uuid', (col) =>
      col.notNull().references('subjects.id').onDelete('restrict'),
    )
    // Array of chapter ids — not FK-enforced; chapters are never hard-deleted (CLAUDE.md
    // invariant 4), so a dangling reference here cannot happen in practice.
    .addColumn('chapter_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('total_marks', 'integer', (col) => col.notNull())
    .addColumn('duration_min', 'integer', (col) => col.notNull())
    .addColumn('weighting', 'jsonb')
    .addColumn('theme', 'text', (col) => col.notNull().defaultTo('Plain'))
    .addColumn('generated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('pdf_ref', 'text')
    .addColumn('key_pdf_ref', 'text')
    .addColumn('shortfalls', 'jsonb')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('papers').execute()
}
