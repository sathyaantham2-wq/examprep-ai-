import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F093: "Events: paper generated, downloaded, attempted, uploaded, evaluated, remediated; funnel
// view; privacy-respecting, no third-party ad pixels." A first-party events log, not a
// third-party analytics SDK -- every row is one of this app's own household/student actions,
// never sent anywhere external.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('product_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('households.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('event_type', 'text', (col) =>
      col.notNull().check(
        sql`event_type in (
          'paper_generated', 'paper_downloaded', 'attempt_submitted',
          'attempt_uploaded', 'evaluation_completed', 'remediation_started'
        )`,
      ),
    )
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('product_events_type_created_idx')
    .on('product_events')
    .columns(['event_type', 'created_at'])
    .execute()

  await db.schema
    .createIndex('product_events_household_created_idx')
    .on('product_events')
    .columns(['household_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('product_events').execute()
}
