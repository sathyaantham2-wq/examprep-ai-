import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// concept_mastery.status_at_time never had a CHECK constraint (F011 migration 0025), unlike
// concept_status.status which shares the same five-value domain. Caught while adding test
// coverage for the F063 state machine, which reads this column and needs its type to actually
// match ConceptStatusValue rather than plain text.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concept_mastery')
    .addCheckConstraint(
      'concept_mastery_status_at_time_check',
      sql`status_at_time in ('Strong', 'Needs Practice', 'Weak', 'Priority', 'Maintenance')`,
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concept_mastery')
    .dropConstraint('concept_mastery_status_at_time_check')
    .execute()
}
