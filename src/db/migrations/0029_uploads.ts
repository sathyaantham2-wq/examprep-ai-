import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uploads')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('attempt_id', 'uuid', (col) =>
      col.references('attempts.id').onDelete('set null'),
    )
    .addColumn('kind', 'text', (col) =>
      col.notNull().check(sql`kind in ('scan', 'source_pdf')`),
    )
    .addColumn('storage_ref', 'text', (col) => col.notNull())
    .addColumn('page_count', 'integer')
    .addColumn('mime', 'text', (col) => col.notNull())
    .addColumn('size_bytes', 'bigint', (col) => col.notNull())
    .addColumn('uploaded_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('uploads').execute()
}
