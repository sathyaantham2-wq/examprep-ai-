import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F018: "Concept can list prerequisite concept IDs; weak concept surfaces its unmastered
// prerequisites in the diagnosis." Not FK-enforced against `concepts.id` the way question_ids/
// chapter_ids arrays elsewhere in this schema aren't either -- concepts are never hard-deleted
// (CLAUDE.md invariant 4), so a dangling reference here cannot happen in practice.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concepts')
    .addColumn('prerequisite_concept_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concepts')
    .dropColumn('prerequisite_concept_ids')
    .execute()
}
