import { createRepository, createScopedRepository } from './factory'

export const attemptsRepository = createScopedRepository(
  'attempts',
  'student_id',
)

// Ownership only exists via attempt_id -> attempts.student_id; caller verifies that join itself.
export const attemptAnswersRepository = createRepository('attempt_answers')
