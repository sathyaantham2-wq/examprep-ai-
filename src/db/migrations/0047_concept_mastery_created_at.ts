import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F068 surfaced a real ordering bug: concept_mastery.date is a plain DATE (no time-of-day), so
// two ledger rows recorded on the same calendar day -- an exam evaluation and a same-day drill,
// exactly what remediation practice produces -- can't be recency-ordered by date alone. F063's
// "two consecutive >=85% attempts" escalation rule reads "most recent" via
// listForConcept(...).orderBy('date','desc').limit(2), which without a tiebreaker can return
// same-day rows in an arbitrary order. created_at gives that tiebreaker.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concept_mastery')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('concept_mastery').dropColumn('created_at').execute()
}
