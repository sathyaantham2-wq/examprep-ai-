import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F098: "hard delete within 30 days" is a deliberate, DPDP-driven exception to CLAUDE.md
// invariant 4 ("nothing is deleted") -- a genuine right-to-erasure request must actually erase.
// This table is the audit trail for that exception, so household_id is a plain uuid column, NOT
// a foreign key to households.id -- if it referenced households with ON DELETE CASCADE, the
// audit row would vanish in the same transaction as the data it's supposed to prove was deleted.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('deletion_log')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('household_id', 'uuid', (col) => col.notNull())
    .addColumn('household_name', 'text', (col) => col.notNull())
    .addColumn('requested_by_user_id', 'uuid', (col) => col.notNull())
    .addColumn('deleted_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('deletion_log').execute()
}
