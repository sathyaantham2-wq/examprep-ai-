import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('evaluations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('attempt_id', 'uuid', (col) =>
      col.notNull().references('attempts.id').onDelete('cascade'),
    )
    .addColumn('actual_score', 'numeric')
    .addColumn('knowledge_score', 'numeric')
    .addColumn('delivery_gap', 'numeric')
    .addColumn('total_marks', 'numeric', (col) => col.notNull())
    .addColumn('percentage', 'numeric')
    .addColumn('grade', 'text')
    // AI never finalises a mark (CLAUDE.md hard rule) — evaluated_by records provenance, and
    // confirmed_at is null until a human confirms; the mastery ledger only reads confirmed rows.
    .addColumn('evaluated_by', 'text', (col) =>
      col.notNull().check(sql`evaluated_by in ('ai', 'human', 'mixed')`),
    )
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('remarks', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('evaluations').execute()
}
