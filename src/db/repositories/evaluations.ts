import { createRepository } from './factory'

// None of these have a direct student_id/household_id column — ownership only exists via
// attempt_id -> attempts.student_id (or evaluation_id -> evaluations -> attempts). Callers verify
// that join themselves when it matters.
export const evaluationsRepository = createRepository('evaluations')
export const evaluationItemsRepository = createRepository('evaluation_items')

// Pattern/habit libraries are global reference data (P1-P6, H1-H10), editable but not per
// household.
export const patternsRepository = createRepository('patterns')
export const patternHitsRepository = createRepository('pattern_hits')
export const habitsRepository = createRepository('habits')
export const habitObservationsRepository =
  createRepository('habit_observations')
