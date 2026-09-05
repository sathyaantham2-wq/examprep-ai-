import { createRepository, createScopedRepository } from './factory'

// The question bank is global reference data (not household-owned), unscoped.
export const questionsRepository = createRepository('questions')
export const questionOptionsRepository = createRepository('question_options')
export const questionStepMarksRepository = createRepository(
  'question_step_marks',
)

// Which student has seen which question — always scoped by student.
export const questionUsageRepository = createScopedRepository(
  'question_usage',
  'student_id',
)
