import type { Insertable, Selectable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import type { HabitRating } from '../enums'
import { createRepository } from './factory'

// Neither evaluations nor evaluation_items has a direct student_id/household_id column —
// ownership only exists via evaluation_id -> evaluations.attempt_id -> attempts.student_id.
export const evaluationsRepository = {
  ...createRepository('evaluations'),
  // GET/PATCH/confirm all need "does this evaluation belong to my household" in one query.
  async findByIdForHousehold(
    db: Db,
    householdId: string,
    evaluationId: string,
  ) {
    return db
      .selectFrom('evaluations')
      .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
      .innerJoin('students', 'students.id', 'attempts.student_id')
      .selectAll('evaluations')
      .where('students.household_id', '=', householdId)
      .where('evaluations.id', '=', evaluationId)
      .executeTakeFirst()
  },
  // createEvaluation() doesn't flip attempts.status until confirmEvaluation() does -- so an
  // attempt sits at 'submitted' the whole time its evaluation exists but isn't confirmed yet.
  // Without this, reopening the review screen before confirming would call POST
  // /api/evaluations again and create a second, orphaned evaluation for the same attempt.
  async findByAttemptId(db: Db, attemptId: string) {
    return db
      .selectFrom('evaluations')
      .selectAll()
      .where('attempt_id', '=', attemptId)
      .executeTakeFirst()
  },
}

export const evaluationItemsRepository = {
  ...createRepository('evaluation_items'),
  async listForEvaluation(db: Db, evaluationId: string) {
    return db
      .selectFrom('evaluation_items')
      .selectAll()
      .where('evaluation_id', '=', evaluationId)
      .execute() as Promise<Array<Selectable<DB['evaluation_items']>>>
  },
  async insertMany(db: Db, rows: Array<Insertable<DB['evaluation_items']>>) {
    return db
      .insertInto('evaluation_items')
      .values(rows)
      .returningAll()
      .execute() as Promise<Array<Selectable<DB['evaluation_items']>>>
  },
  // F060: "wrong answers ... routed to a drill instead of re-teaching" -- to decide which kind of
  // drill, buildRemediationPack needs to know whether this student's wrong answers on this
  // concept were mostly a reading-discipline habit rather than a genuine gap. Confirmed
  // evaluations only (an AI-proposed, unconfirmed error_type is not a fact yet), grouped rather
  // than filtered to one type since the caller compares counts.
  async countErrorTypesForConcept(
    db: Db,
    studentId: string,
    conceptId: string,
  ) {
    return db
      .selectFrom('evaluation_items')
      .innerJoin(
        'evaluations',
        'evaluations.id',
        'evaluation_items.evaluation_id',
      )
      .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
      .innerJoin(
        'paper_questions',
        'paper_questions.id',
        'evaluation_items.paper_question_id',
      )
      .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
      .select([
        'evaluation_items.error_type',
        (eb) => eb.fn.countAll().as('count'),
      ])
      .where('attempts.student_id', '=', studentId)
      .where('questions.concept_id', '=', conceptId)
      .where('evaluations.confirmed_at', 'is not', null)
      .where('evaluation_items.error_type', 'is not', null)
      .groupBy('evaluation_items.error_type')
      .execute()
  },
}

// Pattern/habit libraries are global reference data (P1-P6, H1-H10), editable but not per
// household.
export const patternsRepository = createRepository('patterns')

export const patternHitsRepository = {
  ...createRepository('pattern_hits'),
  async listForItem(db: Db, evaluationItemId: string) {
    return db
      .selectFrom('pattern_hits')
      .selectAll()
      .where('evaluation_item_id', '=', evaluationItemId)
      .execute() as Promise<Array<Selectable<DB['pattern_hits']>>>
  },
  // F057: "each answer can carry one or more" patterns — a full replace on every override call
  // (rather than an additive insert) keeps re-submitting the same PATCH idempotent.
  async replaceForItem(
    db: Db,
    evaluationItemId: string,
    patternIds: Array<string>,
  ) {
    await db
      .deleteFrom('pattern_hits')
      .where('evaluation_item_id', '=', evaluationItemId)
      .execute()
    if (patternIds.length === 0) return []
    return db
      .insertInto('pattern_hits')
      .values(
        patternIds.map((patternId) => ({
          evaluation_item_id: evaluationItemId,
          pattern_id: patternId,
        })),
      )
      .returningAll()
      .execute() as Promise<Array<Selectable<DB['pattern_hits']>>>
  },
  // F065: "patterns ... aggregated across all subjects, not just per paper" -- deliberately not
  // scoped to a subject_id anywhere in this query (unlike buildParentDashboard's per-subject
  // cards), across every one of this student's confirmed evaluations regardless of which subject
  // the paper belonged to.
  async countForStudent(db: Db, studentId: string) {
    const rows = await db
      .selectFrom('pattern_hits')
      .innerJoin(
        'evaluation_items',
        'evaluation_items.id',
        'pattern_hits.evaluation_item_id',
      )
      .innerJoin(
        'evaluations',
        'evaluations.id',
        'evaluation_items.evaluation_id',
      )
      .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
      .innerJoin('patterns', 'patterns.id', 'pattern_hits.pattern_id')
      .select([
        'patterns.id as pattern_id',
        'patterns.code as pattern_code',
        'patterns.name as pattern_name',
        (eb) => eb.fn.countAll<string>().as('count'),
      ])
      .where('attempts.student_id', '=', studentId)
      .where('evaluations.confirmed_at', 'is not', null)
      .groupBy(['patterns.id', 'patterns.code', 'patterns.name'])
      .execute()
    // Sorted in JS (Kysely's typed orderBy can't reliably reference a computed select alias) --
    // highest-frequency pattern first, matching computeCoverageGridForSubject's own precedent.
    return rows.sort((a, b) => Number(b.count) - Number(a.count))
  },
}

export const habitsRepository = createRepository('habits')

export const habitObservationsRepository = {
  ...createRepository('habit_observations'),
  async listForEvaluation(db: Db, evaluationId: string) {
    return db
      .selectFrom('habit_observations')
      .selectAll()
      .where('evaluation_id', '=', evaluationId)
      .execute() as Promise<Array<Selectable<DB['habit_observations']>>>
  },
  // F058: "each habit rated present/partial/absent per paper" -- one rating per (evaluation,
  // habit), so a full replace on every call (rather than an additive insert) keeps re-submitting
  // the same PATCH idempotent, the same pattern replaceForItem already uses for pattern_hits.
  async replaceForEvaluation(
    db: Db,
    evaluationId: string,
    observations: Array<{
      habit_id: string
      rating: HabitRating
      evidence_note?: string
    }>,
  ) {
    await db
      .deleteFrom('habit_observations')
      .where('evaluation_id', '=', evaluationId)
      .execute()
    if (observations.length === 0) return []
    return db
      .insertInto('habit_observations')
      .values(
        observations.map((o) => ({
          evaluation_id: evaluationId,
          habit_id: o.habit_id,
          rating: o.rating,
          evidence_note: o.evidence_note,
        })),
      )
      .returningAll()
      .execute() as Promise<Array<Selectable<DB['habit_observations']>>>
  },
  // F058: "a trend line" -- every rating this student has ever received for each habit, oldest
  // first, across all of their confirmed evaluations (not just one paper).
  async trendForStudent(db: Db, studentId: string) {
    return db
      .selectFrom('habit_observations')
      .innerJoin(
        'evaluations',
        'evaluations.id',
        'habit_observations.evaluation_id',
      )
      .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
      .innerJoin('habits', 'habits.id', 'habit_observations.habit_id')
      .select([
        'habits.id as habit_id',
        'habits.code as habit_code',
        'habits.name as habit_name',
        'habit_observations.rating',
        'evaluations.confirmed_at',
      ])
      .where('attempts.student_id', '=', studentId)
      .where('evaluations.confirmed_at', 'is not', null)
      .orderBy('evaluations.confirmed_at', 'asc')
      .execute()
  },
}
