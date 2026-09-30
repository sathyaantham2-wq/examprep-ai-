import type { Insertable, Selectable, Updateable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'

// F050-F053 + F097. Both tables are scoped by student_id like every other attempt-owned table;
// callers resolve the student (student self, or a parent in her household) before calling.

// Everything except the encrypted image, so listing pages never pulls megabytes of ciphertext.
const PAGE_META = [
  'id',
  'attempt_id',
  'student_id',
  'upload_id',
  'page_number',
  'mime',
  'size_bytes',
  'extracted_at',
  'extraction_error',
  'uploaded_by_user_id',
  'created_at',
  'purged_at',
] as const

export type ScanPageMeta = Pick<Selectable<DB['scan_pages']>, (typeof PAGE_META)[number]>

export const scanPagesRepository = {
  async insert(db: Db, row: Insertable<DB['scan_pages']>) {
    return db
      .insertInto('scan_pages')
      .values(row)
      .returning(PAGE_META)
      .executeTakeFirstOrThrow() as Promise<ScanPageMeta>
  },
  async listForAttempt(db: Db, studentId: string, attemptId: string) {
    return db
      .selectFrom('scan_pages')
      .select(PAGE_META)
      .where('student_id', '=', studentId)
      .where('attempt_id', '=', attemptId)
      .orderBy('page_number')
      .orderBy('created_at')
      .execute() as Promise<Array<ScanPageMeta>>
  },
  async findMeta(db: Db, studentId: string, pageId: string) {
    return db
      .selectFrom('scan_pages')
      .select(PAGE_META)
      .where('student_id', '=', studentId)
      .where('id', '=', pageId)
      .executeTakeFirst() as Promise<ScanPageMeta | undefined>
  },
  /** The page with its encrypted image, found by id alone -- the caller checks access itself. */
  async findWithImage(db: Db, pageId: string) {
    return db
      .selectFrom('scan_pages')
      .select([...PAGE_META, 'image'])
      .where('id', '=', pageId)
      .executeTakeFirst()
  },
  async update(
    db: Db,
    studentId: string,
    pageId: string,
    patch: Updateable<DB['scan_pages']>,
  ) {
    await db
      .updateTable('scan_pages')
      .set(patch)
      .where('student_id', '=', studentId)
      .where('id', '=', pageId)
      .execute()
  },
  async remove(db: Db, studentId: string, pageId: string) {
    await db
      .deleteFrom('scan_pages')
      .where('student_id', '=', studentId)
      .where('id', '=', pageId)
      .execute()
  },
  async totalBytes(db: Db, attemptId: string) {
    const row = await db
      .selectFrom('scan_pages')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('size_bytes'), eb.lit(0)).as('total'))
      .where('attempt_id', '=', attemptId)
      .executeTakeFirstOrThrow()
    return Number(row.total)
  },
  /** F097 retention: drops the image (keeps the row) for pages older than the cutoff. */
  async purgeOlderThan(db: Db, cutoff: Date) {
    const result = await db
      .updateTable('scan_pages')
      .set({ image: null, purged_at: new Date() })
      .where('purged_at', 'is', null)
      .where('created_at', '<', cutoff)
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  },
}

export const scanDetectionsRepository = {
  async listForAttempt(db: Db, studentId: string, attemptId: string) {
    return db
      .selectFrom('scan_detections')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('attempt_id', '=', attemptId)
      .orderBy('created_at')
      .execute() as Promise<Array<Selectable<DB['scan_detections']>>>
  },
  async findById(db: Db, studentId: string, id: string) {
    return db
      .selectFrom('scan_detections')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<Selectable<DB['scan_detections']> | undefined>
  },
  /** Re-reading a page replaces everything previously found on it. */
  async replaceForPage(
    db: Db,
    studentId: string,
    pageId: string,
    rows: Array<Insertable<DB['scan_detections']>>,
  ) {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('scan_detections')
        .where('student_id', '=', studentId)
        .where('scan_page_id', '=', pageId)
        .execute()
      if (rows.length > 0) await trx.insertInto('scan_detections').values(rows).execute()
    })
  },
  async update(
    db: Db,
    studentId: string,
    id: string,
    patch: Updateable<DB['scan_detections']>,
  ) {
    await db
      .updateTable('scan_detections')
      .set(patch)
      .where('student_id', '=', studentId)
      .where('id', '=', id)
      .execute()
  },
  async setStatuses(db: Db, studentId: string, statuses: Map<string, string>) {
    await db.transaction().execute(async (trx) => {
      for (const [id, status] of statuses) {
        await trx
          .updateTable('scan_detections')
          .set({ status })
          .where('student_id', '=', studentId)
          .where('id', '=', id)
          .where('status', '!=', status)
          .execute()
      }
    })
  },
}

// A parent (or admin) reaches a student's attempt through her household, the same join
// POST /api/evaluations uses. A student reaches only her own, via attemptsRepository.
export const scanAccessRepository = {
  async findAttemptInHousehold(db: Db, householdId: string, attemptId: string) {
    return db
      .selectFrom('attempts')
      .innerJoin('students', 'students.id', 'attempts.student_id')
      .selectAll('attempts')
      .select(['students.household_id as student_household_id'])
      .where('students.household_id', '=', householdId)
      .where('attempts.id', '=', attemptId)
      .executeTakeFirst()
  },
  async findPaperInHousehold(db: Db, householdId: string, paperId: string) {
    return db
      .selectFrom('papers')
      .innerJoin('students', 'students.id', 'papers.student_id')
      .select(['papers.id', 'papers.student_id', 'students.household_id'])
      .where('students.household_id', '=', householdId)
      .where('papers.id', '=', paperId)
      .executeTakeFirst()
  },
  async studentHouseholdId(db: Db, studentId: string) {
    const row = await db
      .selectFrom('students')
      .select('household_id')
      .where('id', '=', studentId)
      .executeTakeFirst()
    return row?.household_id ?? null
  },
  async optionLabelsForQuestions(db: Db, questionIds: Array<string>) {
    if (questionIds.length === 0) return []
    return db
      .selectFrom('question_options')
      .select(['question_id', 'label', 'order_index'])
      .where('question_id', 'in', questionIds)
      .orderBy('order_index')
      .execute()
  },
}
