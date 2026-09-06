import type { Insertable, Selectable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createRepository } from './factory'

// Neither evaluations nor evaluation_items has a direct student_id/household_id column —
// ownership only exists via evaluation_id -> evaluations.attempt_id -> attempts.student_id.
export const evaluationsRepository = {
  ...createRepository('evaluations'),
  // GET/PATCH/confirm all need "does this evaluation belong to my household" in one query.
  async findByIdForHousehold(
    db: Db,
    householdId: string,
    evaluationId: string,
  ) {
    return db
      .selectFrom('evaluations')
      .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
      .innerJoin('students', 'students.id', 'attempts.student_id')
      .selectAll('evaluations')
      .where('students.household_id', '=', householdId)
      .where('evaluations.id', '=', evaluationId)
      .executeTakeFirst()
  },
}

export const evaluationItemsRepository = {
  ...createRepository('evaluation_items'),
  async listForEvaluation(db: Db, evaluationId: string) {
    return db
      .selectFrom('evaluation_items')
      .selectAll()
      .where('evaluation_id', '=', evaluationId)
      .execute() as Promise<Array<Selectable<DB['evaluation_items']>>>
  },
  async insertMany(db: Db, rows: Array<Insertable<DB['evaluation_items']>>) {
    return db
      .insertInto('evaluation_items')
      .values(rows)
      .returningAll()
      .execute() as Promise<Array<Selectable<DB['evaluation_items']>>>
  },
}

// Pattern/habit libraries are global reference data (P1-P6, H1-H10), editable but not per
// household.
export const patternsRepository = createRepository('patterns')
export const patternHitsRepository = createRepository('pattern_hits')
export const habitsRepository = createRepository('habits')
export const habitObservationsRepository =
  createRepository('habit_observations')
