import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('households.id').onDelete('cascade'),
    )
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('role', 'text', (col) =>
      col.notNull().check(sql`role in ('parent', 'student', 'admin')`),
    )
    .addColumn('auth_provider', 'text', (col) =>
      col.notNull().defaultTo('password'),
    )
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  // Close the circular reference from households.owner_user_id now that users exists.
  await db.schema
    .alterTable('households')
    .addForeignKeyConstraint(
      'households_owner_user_id_fkey',
      ['owner_user_id'],
      'users',
      ['id'],
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('households')
    .dropConstraint('households_owner_user_id_fkey')
    .execute()
  await db.schema.dropTable('users').execute()
}
