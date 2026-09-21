import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// Class 0 stands for the competitive-exam track (Civil Services, Groups), which has a syllabus
// (board) but no school class. Class stays a first-class column everywhere; only the lower bound
// of the allowed range moves from 1 to 0.
const TABLES = ['students', 'subjects', 'concepts', 'questions', 'blueprints']

export async function up(db: Kysely<any>): Promise<void> {
  for (const table of TABLES) {
    await sql`alter table ${sql.table(table)} drop constraint ${sql.id(`${table}_class_check`)}`.execute(db)
    await sql`alter table ${sql.table(table)} add constraint ${sql.id(`${table}_class_check`)} check (class between 0 and 12)`.execute(db)
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of TABLES) {
    await sql`alter table ${sql.table(table)} drop constraint ${sql.id(`${table}_class_check`)}`.execute(db)
    await sql`alter table ${sql.table(table)} add constraint ${sql.id(`${table}_class_check`)} check (class between 1 and 12)`.execute(db)
  }
}
