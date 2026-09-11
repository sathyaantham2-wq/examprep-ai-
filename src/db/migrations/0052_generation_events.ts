import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F112: "Student role may generate ... papers within a daily quota." A dedicated append-only
// ledger (CLAUDE.md invariant 4) rather than a column on `papers` -- the quota only ever gates
// student-SELF-triggered generation, not a parent generating an exam paper for their kid, and not
// a remediation/habit-drill task's own internal paper creation (src/lib/remediation.ts), so this
// needs to record who triggered each real generate call, not what got generated.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('generation_events')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('triggered_by', 'text', (col) =>
      col.notNull().check(sql`triggered_by in ('student', 'parent', 'admin')`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('generation_events').execute()
}
