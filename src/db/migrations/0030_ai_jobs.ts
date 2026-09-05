import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ai_jobs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('households.id').onDelete('cascade'),
    )
    .addColumn('feature', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('prompt_ref', 'text')
    .addColumn('tokens_in', 'integer')
    .addColumn('tokens_out', 'integer')
    .addColumn('cost_inr', sql`numeric(10, 4)`)
    .addColumn('latency_ms', 'integer')
    .addColumn('status', 'text', (col) =>
      col.notNull().check(sql`status in ('success', 'error', 'pending')`),
    )
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('ai_jobs_household_created_idx')
    .on('ai_jobs')
    .columns(['household_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('ai_jobs').execute()
}
