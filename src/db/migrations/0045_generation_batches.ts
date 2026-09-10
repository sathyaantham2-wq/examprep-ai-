import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F116: bulk generation at scale needs its own resumable state, distinct from ai_jobs (F091's
// per-call cost log) -- a batch is "generate every shortfall Bloom x difficulty cell for a
// subject, up to a cost cap", not a single AI call. Global reference data (questions/concepts
// aren't household-owned), so no household_id here, matching questions/concepts themselves.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('generation_batches')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('subject_id', 'uuid', (col) =>
      col.notNull().references('subjects.id').onDelete('cascade'),
    )
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(
          sql`status in ('pending', 'running', 'paused', 'completed', 'failed')`,
        ),
    )
    .addColumn('cost_cap_inr', sql`numeric(10, 4)`, (col) => col.notNull())
    .addColumn('cost_spent_inr', sql`numeric(10, 4)`, (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('error', 'text')
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  // One row per (concept, bloom, difficulty) cell this batch is topping up -- "chunked by
  // concept and grid cell". Unique per batch so planBatch() can never double-enqueue a cell, and
  // status lets resume() skip cells a prior run already finished (no duplicate generation).
  await db.schema
    .createTable('generation_batch_items')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('batch_id', 'uuid', (col) =>
      col.notNull().references('generation_batches.id').onDelete('cascade'),
    )
    .addColumn('concept_id', 'uuid', (col) =>
      col.notNull().references('concepts.id').onDelete('cascade'),
    )
    .addColumn('bloom', 'text', (col) => col.notNull())
    .addColumn('difficulty', 'text', (col) => col.notNull())
    .addColumn('target_count', 'integer', (col) => col.notNull())
    .addColumn('generated_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'done', 'failed', 'skipped')`),
    )
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('generation_batch_items_cell_key', [
      'batch_id',
      'concept_id',
      'bloom',
      'difficulty',
    ])
    .execute()

  await db.schema
    .createIndex('generation_batch_items_batch_status_idx')
    .on('generation_batch_items')
    .columns(['batch_id', 'status'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('generation_batch_items').execute()
  await db.schema.dropTable('generation_batches').execute()
}
