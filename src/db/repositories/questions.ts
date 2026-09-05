import type {
  BloomLevel,
  DifficultyTier,
  QuestionStatus,
  QuestionType,
} from '../enums'
import type { Db } from '../connection'
import { createRepository, createScopedRepository } from './factory'

export interface QuestionFilters {
  concept_id?: string
  bloom?: BloomLevel
  difficulty?: DifficultyTier
  type?: QuestionType
  status?: QuestionStatus
}

// The question bank is global reference data (not household-owned), unscoped.
export const questionsRepository = {
  ...createRepository('questions'),
  // Powers GET /api/questions?concept=&bloom=&difficulty=&type=&status= (F020).
  async search(
    db: Db,
    filters: QuestionFilters,
    limit: number,
    offset: number,
  ) {
    let query = db.selectFrom('questions').selectAll()
    if (filters.concept_id)
      query = query.where('concept_id', '=', filters.concept_id)
    if (filters.bloom) query = query.where('bloom', '=', filters.bloom)
    if (filters.difficulty)
      query = query.where('difficulty', '=', filters.difficulty)
    if (filters.type) query = query.where('type', '=', filters.type)
    if (filters.status) query = query.where('status', '=', filters.status)

    const [items, countResult] = await Promise.all([
      query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
      query
        .clearSelect()
        .clearOrderBy()
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    ])

    return { items, total: Number(countResult.count) }
  },
}

export const questionOptionsRepository = createRepository('question_options')
export const questionStepMarksRepository = createRepository(
  'question_step_marks',
)

// Which student has seen which question — always scoped by student.
export const questionUsageRepository = createScopedRepository(
  'question_usage',
  'student_id',
)
