import type { Kysely } from 'kysely'

// F069: how far along the 7/21/60-day spaced re-test ladder a cleared (Strong/Maintenance)
// concept is. Reset to 0 the moment a concept drops back to Priority/Weak/Needs Practice, so a
// concept that regresses restarts the ladder from the top on its next clear.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concept_status')
    .addColumn('retest_stage', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('concept_status').dropColumn('retest_stage').execute()
}
