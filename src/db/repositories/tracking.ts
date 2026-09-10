import { sql } from 'kysely'
import type { Insertable, Selectable, Updateable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import type { ConceptStatusValue } from '../enums'
import { createScopedRepository } from './factory'

// Append-only ledger (CLAUDE.md invariant 4) — insert only, so there is no update method here
// even though createScopedRepository would offer one.
const concept_mastery = createScopedRepository('concept_mastery', 'student_id')
export const conceptMasteryRepository = {
  findById: concept_mastery.findById,
  list: concept_mastery.list,
  insert: concept_mastery.insert,
  // Most-recent-first history for one (student, concept) pair — the escalation rules in
  // src/lib/mastery.ts (F063) need to see the last couple of appearances, not the whole ledger.
  async listForConcept(
    db: Db,
    studentId: string,
    conceptId: string,
    limit = 3,
  ) {
    return db
      .selectFrom('concept_mastery')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('concept_id', '=', conceptId)
      .orderBy('date', 'desc')
      .limit(limit)
      .execute() as Promise<Array<Selectable<DB['concept_mastery']>>>
  },
  // F074: date is a DATE column (no time-of-day) -- explicit ::date casts on plain YYYY-MM-DD
  // strings compare unambiguously at calendar-day granularity, avoiding the timezone-dependent
  // cast Postgres would otherwise apply comparing a DATE column against a timestamptz instant
  // (which silently excludes "today" when the instant is also today).
  async listForStudentInDateWindow(
    db: Db,
    studentId: string,
    startDateInclusive: string,
    endDateExclusive: string,
  ) {
    return db
      .selectFrom('concept_mastery')
      .innerJoin('concepts', 'concepts.id', 'concept_mastery.concept_id')
      .select([
        'concept_mastery.concept_id',
        'concept_mastery.ratio',
        'concepts.name as concept_name',
      ])
      .where('concept_mastery.student_id', '=', studentId)
      .where(sql<boolean>`concept_mastery.date >= ${startDateInclusive}::date`)
      .where(sql<boolean>`concept_mastery.date < ${endDateExclusive}::date`)
      .execute()
  },
  async findMostRecentBeforeDate(
    db: Db,
    studentId: string,
    conceptId: string,
    beforeDate: string,
  ) {
    return db
      .selectFrom('concept_mastery')
      .select('ratio')
      .where('student_id', '=', studentId)
      .where('concept_id', '=', conceptId)
      .where(sql<boolean>`date < ${beforeDate}::date`)
      .orderBy('date', 'desc')
      .executeTakeFirst()
  },
}

// concept_status has a composite primary key (student_id, concept_id) — no id column — so it
// doesn't fit the id-based factory shape. It's mutable current-state, safe to overwrite in place.
export const conceptStatusRepository = {
  async findOne(db: Db, studentId: string, conceptId: string) {
    return db
      .selectFrom('concept_status')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('concept_id', '=', conceptId)
      .executeTakeFirst() as Promise<
      Selectable<DB['concept_status']> | undefined
    >
  },
  async list(db: Db, studentId: string) {
    return db
      .selectFrom('concept_status')
      .selectAll()
      .where('student_id', '=', studentId)
      .execute() as Promise<Array<Selectable<DB['concept_status']>>>
  },
  // Powers GET /api/tracker/:studentId (F064) — subject_id comes via chapters, concepts has no
  // direct subject_id column.
  async listForStudentWithFilter(
    db: Db,
    studentId: string,
    filters: { subjectId?: string; status?: ConceptStatusValue },
  ) {
    let query = db
      .selectFrom('concept_status')
      .innerJoin('concepts', 'concepts.id', 'concept_status.concept_id')
      .innerJoin('chapters', 'chapters.id', 'concepts.chapter_id')
      .select([
        'concept_status.student_id',
        'concept_status.concept_id',
        'concepts.code as concept_code',
        'concepts.name as concept_name',
        'chapters.subject_id',
        'concept_status.attempts',
        'concept_status.avg_ratio',
        'concept_status.last_ratio',
        'concept_status.trend',
        'concept_status.status',
        'concept_status.flagged_at',
        'concept_status.next_retest_at',
      ])
      .where('concept_status.student_id', '=', studentId)

    if (filters.subjectId)
      query = query.where('chapters.subject_id', '=', filters.subjectId)
    if (filters.status)
      query = query.where('concept_status.status', '=', filters.status)

    return query.orderBy('concepts.code').execute()
  },
  async upsert(db: Db, row: Insertable<DB['concept_status']>) {
    const update: Updateable<DB['concept_status']> = row
    return db
      .insertInto('concept_status')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['student_id', 'concept_id']).doUpdateSet(update),
      )
      .returningAll()
      .executeTakeFirstOrThrow() as Promise<Selectable<DB['concept_status']>>
  },
}

export const remediationTasksRepository = createScopedRepository(
  'remediation_tasks',
  'student_id',
)
export const studyPlansRepository = createScopedRepository(
  'study_plans',
  'student_id',
)
