import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F010: "Toggle per student; disabled student sees a friendly locked screen; parent always
// retains access." Defaults true so every existing student stays reachable after this migration
// runs -- disabling is something a parent opts into per student, never the other way around.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('students')
    .addColumn('access_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(sql`true`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('students').dropColumn('access_enabled').execute()
}
