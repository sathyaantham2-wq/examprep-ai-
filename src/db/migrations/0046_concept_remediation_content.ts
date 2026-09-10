import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F067: "AI produces step-by-step solutions ... reviewed once per concept then cached, not
// regenerated per student." One row per concept -- every student's remediation_tasks row for
// that concept reuses this instead of calling the model again.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('concept_remediation_content')
    .addColumn('concept_id', 'uuid', (col) =>
      col
        .primaryKey()
        .references('concepts.id')
        .onDelete('cascade'),
    )
    .addColumn('refresher', 'text')
    .addColumn('examples', 'jsonb')
    .addColumn('source', 'text', (col) =>
      col.notNull().check(sql`source in ('ai', 'bank_fallback')`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('concept_remediation_content').execute()
}
