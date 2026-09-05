import type { Insertable, Selectable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createRepository } from './factory'

// Global reference data — same content regardless of household, so unscoped.
export const subjectsRepository = createRepository('subjects')
export const sourcesRepository = createRepository('sources')
export const chaptersRepository = createRepository('chapters')
export const chapterScopeRepository = createRepository('chapter_scope')
export const conceptsRepository = createRepository('concepts')

// concept_prereqs has a composite primary key (concept_id, prereq_concept_id) — no id column —
// so it doesn't fit the id-based factory shape.
export const conceptPrereqsRepository = {
  async listFor(db: Db, conceptId: string) {
    return db
      .selectFrom('concept_prereqs')
      .selectAll()
      .where('concept_id', '=', conceptId)
      .execute() as Promise<Array<Selectable<DB['concept_prereqs']>>>
  },
  async insert(db: Db, row: Insertable<DB['concept_prereqs']>) {
    return db
      .insertInto('concept_prereqs')
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow() as Promise<Selectable<DB['concept_prereqs']>>
  },
}
