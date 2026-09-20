import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// ADR-0001: chapter identity is (source, part, chapter_no), and concept codes carry the part
// through the chapter, not through a prefix. Class 7 Maths Part II numbers its chapters 1 to 7
// again, so C7M-1.1 legitimately exists once in Part I and once in Part II. A globally unique
// `code` made that impossible; it is now unique within its chapter, which is what a code means.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table concepts drop constraint concepts_code_key`.execute(db)
  await sql`alter table concepts add constraint concepts_chapter_code_key unique (chapter_id, code)`.execute(
    db,
  )
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`alter table concepts drop constraint concepts_chapter_code_key`.execute(db)
  await sql`alter table concepts add constraint concepts_code_key unique (code)`.execute(db)
}
