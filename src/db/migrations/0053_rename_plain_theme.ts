import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F120: "Ship three: Manga, Doodle Journal, Clean School." F034 shipped a placeholder theme named
// 'Plain' before this feature settled on its real name -- renaming existing rows keeps
// papers.theme consistent with the launch names rather than leaving a fourth, orphaned synonym
// around forever.
export async function up(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('papers')
    .set({ theme: 'Clean School' })
    .where('theme', '=', 'Plain')
    .execute()
  await sql`alter table papers alter column theme set default 'Clean School'`.execute(
    db,
  )
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('papers')
    .set({ theme: 'Plain' })
    .where('theme', '=', 'Clean School')
    .execute()
  await sql`alter table papers alter column theme set default 'Plain'`.execute(db)
}
