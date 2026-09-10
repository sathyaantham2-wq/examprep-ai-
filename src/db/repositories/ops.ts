import { sql } from 'kysely'
import type { Insertable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createRepository, createScopedRepository } from './factory'

export const uploadsRepository = createScopedRepository('uploads', 'student_id')
export const aiJobsRepository = createScopedRepository(
  'ai_jobs',
  'household_id',
)

// Scoped by user_id, not household_id directly — a household can have several users
// (parent + student logins), each with their own notification stream.
export const notificationsRepository = createScopedRepository(
  'notifications',
  'user_id',
)

// F116: global reference data (not household-owned), same as questions/concepts.
export const generationBatchesRepository = {
  ...createRepository('generation_batches'),
  async addCostSpent(db: Db, id: string, deltaInr: number) {
    return db
      .updateTable('generation_batches')
      .set({
        cost_spent_inr: sql`cost_spent_inr + ${deltaInr}`,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
  },
}

export const generationBatchItemsRepository = {
  ...createRepository('generation_batch_items'),
  async listByBatch(db: Db, batchId: string) {
    return db
      .selectFrom('generation_batch_items')
      .selectAll()
      .where('batch_id', '=', batchId)
      .orderBy('created_at')
      .execute()
  },
  async listPending(db: Db, batchId: string, limit: number) {
    return db
      .selectFrom('generation_batch_items')
      .selectAll()
      .where('batch_id', '=', batchId)
      .where('status', '=', 'pending')
      .orderBy('created_at')
      .limit(limit)
      .execute()
  },
  async countPending(db: Db, batchId: string) {
    const row = await db
      .selectFrom('generation_batch_items')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('batch_id', '=', batchId)
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },
  async insertMany(
    db: Db,
    rows: Array<Insertable<DB['generation_batch_items']>>,
  ) {
    if (rows.length === 0) return []
    return db
      .insertInto('generation_batch_items')
      .values(rows)
      .returningAll()
      .execute()
  },
}

export const auditLogRepository = {
  ...createScopedRepository('audit_log', 'household_id'),
  // F099: "visible to household owner" -- newest first, capped so a long-lived household can't
  // pull its entire history in one request.
  async listRecent(db: Db, householdId: string, limit: number) {
    return db
      .selectFrom('audit_log')
      .selectAll()
      .where('household_id', '=', householdId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute()
  },
}
