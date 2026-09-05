import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// board/class are denormalized from the chapter's subject onto concepts (and later onto
// questions, blueprints) per CLAUDE.md invariant 2 — first-class columns, never derived only
// through a join chain, so paper generation and question bank queries can filter directly.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('concepts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('chapter_id', 'uuid', (col) =>
      col.notNull().references('chapters.id').onDelete('cascade'),
    )
    .addColumn('board', 'text', (col) => col.notNull())
    .addColumn('class', 'integer', (col) =>
      col.notNull().check(sql`class between 1 and 12`),
    )
    .addColumn('code', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('difficulty_base', 'text', (col) =>
      col.notNull().check(sql`difficulty_base in ('Easy', 'Hard', 'Hardest')`),
    )
    .addColumn('idea', 'text')
    .addColumn('rule', 'text')
    .addColumn('example', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('concepts').execute()
}
