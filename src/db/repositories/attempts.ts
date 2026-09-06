import type { Insertable, Selectable, Updateable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createRepository, createScopedRepository } from './factory'

export const attemptsRepository = createScopedRepository(
  'attempts',
  'student_id',
)

// Ownership only exists via attempt_id -> attempts.student_id; caller verifies that join itself.
export const attemptAnswersRepository = {
  ...createRepository('attempt_answers'),
  async listForAttempt(db: Db, attemptId: string) {
    return db
      .selectFrom('attempt_answers')
      .selectAll()
      .where('attempt_id', '=', attemptId)
      .execute() as Promise<Array<Selectable<DB['attempt_answers']>>>
  },
  // F040 autosave: one row per (attempt, paper_question) — the unique constraint from F011
  // (attempt_answers_attempt_question_key) is what makes this a real upsert instead of a
  // duplicate-row-per-keystroke mess.
  async upsert(db: Db, row: Insertable<DB['attempt_answers']>) {
    const update: Updateable<DB['attempt_answers']> = row
    return db
      .insertInto('attempt_answers')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['attempt_id', 'paper_question_id']).doUpdateSet(update),
      )
      .returningAll()
      .executeTakeFirstOrThrow() as Promise<Selectable<DB['attempt_answers']>>
  },
}
