import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F122: target_question_count per concept, with a launch-default of 20 (CLAUDE.md invariant 3).
// F117: review tier (auto-assigned, never admin-discretionary) plus the approval audit trail --
// tab04's abbreviated column list doesn't name these, but F117's "auditable" requirement has
// nowhere else to live.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concepts')
    .addColumn('target_question_count', 'integer', (col) =>
      col.notNull().defaultTo(20),
    )
    .execute()

  await db.schema
    .alterTable('questions')
    .addColumn('review_tier', 'text', (col) =>
      col.notNull().check(sql`review_tier in ('A', 'B')`),
    )
    .addColumn('review_note', 'text')
    .addColumn('reviewed_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('reviewed_at', 'timestamptz')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concepts')
    .dropColumn('target_question_count')
    .execute()
  await db.schema
    .alterTable('questions')
    .dropColumn('review_tier')
    .dropColumn('review_note')
    .dropColumn('reviewed_by')
    .dropColumn('reviewed_at')
    .execute()
}
