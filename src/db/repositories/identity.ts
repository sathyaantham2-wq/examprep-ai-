import type { Db } from '../connection'
import { createRepository, createScopedRepository } from './factory'

// The tenant root — never itself scoped by household_id (it *is* the household).
export const householdsRepository = createRepository('households')

export const usersRepository = createScopedRepository('users', 'household_id')

export const studentsRepository = {
  ...createScopedRepository('students', 'household_id'),
  // A student attempting a paper is authenticated as themselves (users.id), not scoped by
  // household — this is how a student-role request finds "which student am I" (M08).
  async findByUserId(db: Db, userId: string) {
    return db
      .selectFrom('students')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst()
  },
}

// F095: append-only consent events (CLAUDE.md invariant 4) — withdrawal sets withdrawn_at on the
// row rather than deleting it, so the full consent history stays auditable.
export const consentsRepository = {
  ...createScopedRepository('consents', 'household_id'),
  async findActiveForStudent(db: Db, studentId: string) {
    return db
      .selectFrom('consents')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('withdrawn_at', 'is', null)
      .orderBy('given_at', 'desc')
      .executeTakeFirst()
  },
  async withdraw(db: Db, householdId: string, consentId: string) {
    return db
      .updateTable('consents')
      .set({ withdrawn_at: new Date() })
      .where('id', '=', consentId)
      .where('household_id', '=', householdId)
      .returningAll()
      .executeTakeFirstOrThrow()
  },
}
