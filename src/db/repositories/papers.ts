import { createRepository, createScopedRepository } from './factory'

// Exam patterns are global reference data, not owned by a household.
export const blueprintsRepository = createRepository('blueprints')

export const papersRepository = createScopedRepository('papers', 'student_id')

// Ownership only exists via paper_id -> papers.student_id; the caller must verify that join
// itself when it matters (this table has no direct student/household column to filter on).
export const paperQuestionsRepository = createRepository('paper_questions')
