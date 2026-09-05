import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// Chapter identity is (source_id, part, chapter_no), never chapter_no alone — see
// docs/decisions/ADR-0001-chapter-identity.md. Ganita Prakash Class 7 has two Chapter 3s and two
// Chapter 6s, one per part.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('chapters')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('subject_id', 'uuid', (col) =>
      col.notNull().references('subjects.id').onDelete('cascade'),
    )
    .addColumn('source_id', 'uuid', (col) =>
      col.notNull().references('sources.id').onDelete('restrict'),
    )
    .addColumn('part', 'text', (col) => col.notNull())
    .addColumn('chapter_no', 'integer', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('blurb', 'text')
    .addColumn('order_index', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('chapters_source_part_no_key', [
      'source_id',
      'part',
      'chapter_no',
    ])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('chapters').execute()
}
