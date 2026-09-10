import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F025: AI-generated questions must always land in the review queue as Draft, even when their
// shape would otherwise qualify for F117's Tier A auto-approve (createQuestion() checks this
// column to decide, rather than trusting the caller to remember). Existing rows are all
// human-authored, so backfilling 'manual' is correct, not a placeholder default.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('questions')
    .addColumn('origin', 'text', (col) =>
      col
        .notNull()
        .defaultTo('manual')
        .check(sql`origin in ('manual', 'ai_generated')`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('questions').dropColumn('origin').execute()
}
