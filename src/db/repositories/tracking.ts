import type { Insertable, Selectable, Updateable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createScopedRepository } from './factory'

// Append-only ledger (CLAUDE.md invariant 4) — insert only, so there is no update method here
// even though createScopedRepository would offer one.
const concept_mastery = createScopedRepository('concept_mastery', 'student_id')
export const conceptMasteryRepository = {
  findById: concept_mastery.findById,
  list: concept_mastery.list,
  insert: concept_mastery.insert,
}

// concept_status has a composite primary key (student_id, concept_id) — no id column — so it
// doesn't fit the id-based factory shape. It's mutable current-state, safe to overwrite in place.
export const conceptStatusRepository = {
  async findOne(db: Db, studentId: string, conceptId: string) {
    return db
      .selectFrom('concept_status')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('concept_id', '=', conceptId)
      .executeTakeFirst() as Promise<
      Selectable<DB['concept_status']> | undefined
    >
  },
  async list(db: Db, studentId: string) {
    return db
      .selectFrom('concept_status')
      .selectAll()
      .where('student_id', '=', studentId)
      .execute() as Promise<Array<Selectable<DB['concept_status']>>>
  },
  async upsert(db: Db, row: Insertable<DB['concept_status']>) {
    const update: Updateable<DB['concept_status']> = row
    return db
      .insertInto('concept_status')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['student_id', 'concept_id']).doUpdateSet(update),
      )
      .returningAll()
      .executeTakeFirstOrThrow() as Promise<Selectable<DB['concept_status']>>
  },
}

export const remediationTasksRepository = createScopedRepository(
  'remediation_tasks',
  'student_id',
)
export const studyPlansRepository = createScopedRepository(
  'study_plans',
  'student_id',
)
