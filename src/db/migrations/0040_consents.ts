import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F095: DPDP consent capture. Append-only (CLAUDE.md invariant 4, "nothing is deleted") --
// withdrawal sets withdrawn_at on the row it withdraws rather than removing it, so the consent
// history for a student stays fully auditable. purpose_version pins each consent event to the
// exact wording of the privacy notice that was in force when it was given (src/lib/consent.ts),
// so a later change to that text never silently rewrites what an earlier consent actually said.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('consents')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('households.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('given_by_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('purpose_version', 'text', (col) => col.notNull())
    .addColumn('given_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('withdrawn_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('consents_student_idx')
    .on('consents')
    .columns(['student_id'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('consents').execute()
}
