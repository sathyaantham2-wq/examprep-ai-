import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// owner_user_id -> users(id) is a circular reference (users.household_id -> households.id).
// The FK constraint on owner_user_id is added in 0002_users once the users table exists.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('households')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('owner_user_id', 'uuid')
    .addColumn('plan', 'text', (col) => col.notNull().defaultTo('free'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('households').execute()
}
