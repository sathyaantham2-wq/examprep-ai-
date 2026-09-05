import type { Insertable, Selectable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createRepository, createScopedRepository } from './factory'

// Exam patterns are global reference data, not owned by a household.
export const blueprintsRepository = {
  ...createRepository('blueprints'),
  async listBySubject(db: Db, subjectId: string) {
    return db
      .selectFrom('blueprints')
      .selectAll()
      .where('subject_id', '=', subjectId)
      .orderBy('created_at', 'desc')
      .execute()
  },
}

export const papersRepository = {
  ...createScopedRepository('papers', 'student_id'),
  // papers is scoped by student_id, not household_id — GET /api/papers/:id only has the paper id
  // and the caller's household, so it needs a join through students to check ownership in one
  // query instead of two scoped lookups with mismatched scope columns.
  async findByIdForHousehold(db: Db, householdId: string, paperId: string) {
    return db
      .selectFrom('papers')
      .innerJoin('students', 'students.id', 'papers.student_id')
      .selectAll('papers')
      .where('students.household_id', '=', householdId)
      .where('papers.id', '=', paperId)
      .executeTakeFirst()
  },
}

// Ownership only exists via paper_id -> papers.student_id; the caller must verify that join
// itself when it matters (this table has no direct student/household column to filter on).
export const paperQuestionsRepository = {
  ...createRepository('paper_questions'),
  async insertMany(db: Db, rows: Array<Insertable<DB['paper_questions']>>) {
    return db
      .insertInto('paper_questions')
      .values(rows)
      .returningAll()
      .execute() as Promise<Array<Selectable<DB['paper_questions']>>>
  },
  // GET /api/papers/:id joins in the actual question content — the paper alone is just an
  // ordered list of question ids.
  async listForPaperWithQuestions(db: Db, paperId: string) {
    return db
      .selectFrom('paper_questions')
      .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
      .select([
        'paper_questions.id',
        'paper_questions.paper_id',
        'paper_questions.question_id',
        'paper_questions.section',
        'paper_questions.position',
        'paper_questions.marks',
        'paper_questions.choice_group',
        'questions.concept_id',
        'questions.bloom',
        'questions.difficulty',
        'questions.type',
        'questions.text',
        'questions.answer',
        'questions.hint',
        'questions.diagram_kind',
        'questions.diagram_params',
        'questions.language',
      ])
      .where('paper_questions.paper_id', '=', paperId)
      .orderBy('paper_questions.position')
      .execute()
  },
}
