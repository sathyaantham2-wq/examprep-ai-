import { sql } from 'kysely'
import type { Insertable, Selectable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createRepository } from './factory'

// Global reference data — same content regardless of household, so unscoped.
export const subjectsRepository = {
  ...createRepository('subjects'),
  async listByBoardClass(db: Db, board: string, classNum: number) {
    return db
      .selectFrom('subjects')
      .selectAll()
      .where('board', '=', board)
      .where('class', '=', classNum)
      .where('is_active', '=', true)
      .execute()
  },
}

export const sourcesRepository = createRepository('sources')

export const chaptersRepository = {
  ...createRepository('chapters'),
  // Powers GET /api/syllabus/chapters?subject_id=... — "chapter[] with scope counts" per tab05.
  async listBySubjectWithScopeCounts(db: Db, subjectId: string) {
    return db
      .selectFrom('chapters')
      .leftJoin('chapter_scope', 'chapter_scope.chapter_id', 'chapters.id')
      .select([
        'chapters.id',
        'chapters.subject_id',
        'chapters.source_id',
        'chapters.part',
        'chapters.chapter_no',
        'chapters.name',
        'chapters.blurb',
        'chapters.order_index',
        'chapters.created_at',
        sql<number>`count(*) filter (where chapter_scope.kind = 'IN')`.as(
          'in_scope_count',
        ),
        sql<number>`count(*) filter (where chapter_scope.kind = 'OUT')`.as(
          'out_scope_count',
        ),
      ])
      .where('chapters.subject_id', '=', subjectId)
      .groupBy('chapters.id')
      .orderBy('chapters.order_index')
      .execute()
  },
  // F113: resolves a paper's raw chapter_ids into display info (part + chapter_no + name) for the
  // paper header -- chapter identity is (source, part, chapter_no), never chapter_no alone.
  async listByIds(db: Db, ids: Array<string>) {
    if (ids.length === 0) return []
    return db
      .selectFrom('chapters')
      .select(['id', 'part', 'chapter_no', 'name'])
      .where('id', 'in', ids)
      .orderBy('part')
      .orderBy('chapter_no')
      .execute()
  },
}

export const chapterScopeRepository = {
  ...createRepository('chapter_scope'),
  async listByChapter(db: Db, chapterId: string) {
    return db
      .selectFrom('chapter_scope')
      .selectAll()
      .where('chapter_id', '=', chapterId)
      .orderBy('kind')
      .execute()
  },
  // Bulk-write for POST /api/syllabus/chapters/:id/scope (kind, items[]).
  async insertMany(db: Db, rows: Array<Insertable<DB['chapter_scope']>>) {
    return db.insertInto('chapter_scope').values(rows).returningAll().execute()
  },
}

export const conceptsRepository = createRepository('concepts')

// concept_prereqs has a composite primary key (concept_id, prereq_concept_id) — no id column —
// so it doesn't fit the id-based factory shape.
export const conceptPrereqsRepository = {
  async listFor(db: Db, conceptId: string) {
    return db
      .selectFrom('concept_prereqs')
      .selectAll()
      .where('concept_id', '=', conceptId)
      .execute() as Promise<Array<Selectable<DB['concept_prereqs']>>>
  },
  async insert(db: Db, row: Insertable<DB['concept_prereqs']>) {
    return db
      .insertInto('concept_prereqs')
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow() as Promise<Selectable<DB['concept_prereqs']>>
  },
}
