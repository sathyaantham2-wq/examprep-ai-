import { sql } from 'kysely'
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

export interface EligibleSlotParams {
  conceptIds: Array<string>
  bloomAllowed: Array<BloomLevel>
  difficultiesAllowed: Array<DifficultyTier>
  marks: number
  excludeQuestionIds: Array<string>
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
  // The paper generator's core lookup (F028/F029/F119): approved questions matching a concept
  // pool, an allowed Bloom set, and a difficulty ceiling, excluding ones already used up. Random
  // order so repeated generation doesn't always pick the same question first.
  async findEligibleForSlot(db: Db, params: EligibleSlotParams, limit: number) {
    if (params.conceptIds.length === 0) return []

    let query = db
      .selectFrom('questions')
      .selectAll()
      .where('status', '=', 'approved')
      .where('concept_id', 'in', params.conceptIds)
      .where('bloom', 'in', params.bloomAllowed)
      .where('difficulty', 'in', params.difficultiesAllowed)
      .where('marks', '=', params.marks)

    if (params.excludeQuestionIds.length > 0) {
      query = query.where('id', 'not in', params.excludeQuestionIds)
    }

    return query
      .orderBy(sql`random()`)
      .limit(limit)
      .execute()
  },
  // F066/F068: drill questions are drawn live (never cached, unlike F067's refresher/examples)
  // and restricted to objective types so the drill can score itself instantly with no AI/human
  // grading step -- a subjective question here would break "scored immediately" (F068's AC).
  async findRandomApprovedObjective(
    db: Db,
    conceptId: string,
    objectiveTypes: Array<QuestionType>,
    limit: number,
    // F060: a reading-discipline drill should prefer reversal-word questions (drilling the habit
    // that actually failed) over a random pick from the concept -- ordering by is_reversal_word
    // first rather than filtering on it means a concept with too few tagged questions still fills
    // the drill instead of coming back empty.
    preferReversalWord = false,
  ) {
    let query = db
      .selectFrom('questions')
      .selectAll()
      .where('status', '=', 'approved')
      .where('concept_id', '=', conceptId)
      .where('type', 'in', objectiveTypes)
    if (preferReversalWord) {
      query = query.orderBy('is_reversal_word', 'desc')
    }
    return query
      .orderBy(sql`random()`)
      .limit(limit)
      .execute()
  },
  // F070: habit micro-drills aren't concept-scoped -- a habit like "shows working" is drilled with
  // any approved question of the right type, not questions from one particular concept.
  async findRandomApprovedByType(
    db: Db,
    types: Array<QuestionType>,
    limit: number,
  ) {
    return db
      .selectFrom('questions')
      .selectAll()
      .where('status', '=', 'approved')
      .where('type', 'in', types)
      .orderBy(sql`random()`)
      .limit(limit)
      .execute()
  },
}

export const questionOptionsRepository = {
  ...createRepository('question_options'),
  async listByQuestion(db: Db, questionId: string) {
    return db
      .selectFrom('question_options')
      .selectAll()
      .where('question_id', '=', questionId)
      .orderBy('order_index')
      .execute()
  },
}

export const questionStepMarksRepository = {
  ...createRepository('question_step_marks'),
  async listByQuestion(db: Db, questionId: string) {
    return db
      .selectFrom('question_step_marks')
      .selectAll()
      .where('question_id', '=', questionId)
      .orderBy('step_no')
      .execute()
  },
}

export const questionUsageRepository = {
  ...createScopedRepository('question_usage', 'student_id'),
  async listRecentQuestionIds(db: Db, studentId: string, sinceDays: number) {
    const rows = await db
      .selectFrom('question_usage')
      .select('question_id')
      .where('student_id', '=', studentId)
      .where(
        'served_at',
        '>=',
        sql<Date>`now() - (${sinceDays} || ' days')::interval`,
      )
      .execute()
    return rows.map((row) => row.question_id)
  },
  // F026: "per student, last_served_at and times_served" -- the generator already avoids recent
  // repeats (listRecentQuestionIds above); this is the same underlying data made visible.
  async summaryForStudent(
    db: Db,
    studentId: string,
    questionIds: Array<string>,
  ) {
    if (questionIds.length === 0)
      return new Map<string, { last_served_at: Date; times_served: number }>()
    const rows = await db
      .selectFrom('question_usage')
      .select([
        'question_id',
        (eb) => eb.fn.max('served_at').as('last_served_at'),
        (eb) => eb.fn.countAll<string>().as('times_served'),
      ])
      .where('student_id', '=', studentId)
      .where('question_id', 'in', questionIds)
      .groupBy('question_id')
      .execute()

    return new Map(
      rows.map((row) => [
        row.question_id,
        {
          last_served_at: row.last_served_at,
          times_served: Number(row.times_served),
        },
      ]),
    )
  },
}
