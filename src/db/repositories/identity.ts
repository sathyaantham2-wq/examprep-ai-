import { createRepository, createScopedRepository } from './factory'

// The tenant root — never itself scoped by household_id (it *is* the household).
export const householdsRepository = createRepository('households')

export const usersRepository = createScopedRepository('users', 'household_id')

export const studentsRepository = createScopedRepository(
  'students',
  'household_id',
)
