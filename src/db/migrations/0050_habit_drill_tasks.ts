import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F070: short drills targeting a delivery habit rather than a concept. Deliberately its own table
// rather than widening remediation_tasks -- that table's concept_id is NOT NULL and every existing
// reader/writer of it assumes a concept, so a habit-only variant would need a nullable FK plus a
// mutual-exclusion check on every call site instead of just here.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('habit_drill_tasks')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('habit_id', 'uuid', (col) =>
      col.notNull().references('habits.id').onDelete('restrict'),
    )
    // F070's three named examples (mark-to-point, three-check on assertion-reason, two-minute
    // blank sweep) -- each is its own pass-criteria rule in src/lib/habit-drills.ts.
    .addColumn('drill_kind', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`drill_kind in ('mark_to_point', 'three_check_ar', 'blank_sweep')`,
        ),
    )
    .addColumn('instructions', 'text', (col) => col.notNull())
    .addColumn('question_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending').check(sql`status in ('pending', 'completed')`),
    )
    .addColumn('passed', 'boolean')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('habit_drill_tasks').execute()
}
