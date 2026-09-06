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
