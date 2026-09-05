import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('habit_observations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('evaluation_id', 'uuid', (col) =>
      col.notNull().references('evaluations.id').onDelete('cascade'),
    )
    .addColumn('habit_id', 'uuid', (col) =>
      col.notNull().references('habits.id').onDelete('restrict'),
    )
    .addColumn('rating', 'text', (col) =>
      col.notNull().check(sql`rating in ('present', 'partial', 'absent')`),
    )
    .addColumn('evidence_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('habit_observations').execute()
}
