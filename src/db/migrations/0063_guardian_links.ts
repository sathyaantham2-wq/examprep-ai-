import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// One student, one login. A student now signs up on her own (role 'student') and gets her own
// household plus her own students row. A parent or teacher then asks to see her progress with an
// invite addressed to her email; she approves it. Approval moves her students row (and login) into
// the guardian's household, which is what every existing household-scoped check already reads, so
// no access rule changes. `own_household_id` remembers where she came from so unlinking puts her
// back without deleting anything (CLAUDE.md invariant 4).
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table users drop constraint users_role_check`.execute(db)
  await sql`alter table users add constraint users_role_check check (role in ('parent', 'student', 'teacher', 'admin'))`.execute(
    db,
  )

  // Only read at the moment of sign-up, to choose the role. Never used for authorisation.
  await db.schema.alterTable('users').addColumn('signup_type', 'text').execute()

  await db.schema
    .alterTable('students')
    .addColumn('own_household_id', 'uuid', (col) =>
      col.references('households.id').onDelete('restrict'),
    )
    .execute()

  await db.schema
    .createTable('guardian_invites')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('guardian_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('guardian_household_id', 'uuid', (col) =>
      col.notNull().references('households.id').onDelete('restrict'),
    )
    // Stored lower-cased. The invite is addressed to an email, not to a student id, so a guardian
    // can never learn from the response whether an account exists for that address.
    .addColumn('student_email', 'text', (col) => col.notNull())
    .addColumn('student_id', 'uuid', (col) =>
      col.references('students.id').onDelete('restrict'),
    )
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'approved', 'declined', 'revoked')`),
    )
    .addColumn('consent_given', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('responded_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('guardian_invites_email_idx')
    .on('guardian_invites')
    .column('student_email')
    .execute()
  await db.schema
    .createIndex('guardian_invites_household_idx')
    .on('guardian_invites')
    .column('guardian_household_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('guardian_invites').execute()
  await db.schema.alterTable('students').dropColumn('own_household_id').execute()
  await db.schema.alterTable('users').dropColumn('signup_type').execute()
  await sql`alter table users drop constraint users_role_check`.execute(db)
  await sql`alter table users add constraint users_role_check check (role in ('parent', 'student', 'admin'))`.execute(
    db,
  )
}
