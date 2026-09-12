import { sql } from 'kysely'
import type { Insertable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createRepository, createScopedRepository } from './factory'

export const uploadsRepository = createScopedRepository('uploads', 'student_id')

export type AiUsageGroupBy = 'day' | 'feature' | 'student'

export interface AiUsageAggregateRow {
  group_key: string | null
  calls: number
  tokens_in: number
  tokens_out: number
  cost_inr: number
  avg_latency_ms: number | null
  error_count: number
}

function aiUsageGroupExpr(groupBy: AiUsageGroupBy) {
  if (groupBy === 'day') {
    return sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`
  }
  if (groupBy === 'feature') {
    return sql<string>`feature`
  }
  return sql<string | null>`student_id::text`
}

export const aiJobsRepository = {
  ...createScopedRepository('ai_jobs', 'household_id'),
  // F092: the daily-cap check's raw building block -- count of calls (of any status, capped
  // rejections included, so a burst of rejected calls still shows up as load) since a point in
  // time, globally or narrowed to one household.
  async countSince(db: Db, since: Date, householdId?: string): Promise<number> {
    let query = db
      .selectFrom('ai_jobs')
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('created_at', '>=', since)
    if (householdId) {
      query = query.where('household_id', '=', householdId)
    }
    const row = await query.executeTakeFirstOrThrow()
    return Number(row.c)
  },
  // F121: the per-student spend-cap check's building block -- INR actually spent (successful
  // calls only; a rejected/errored call never reached the model, so it never priced anything) by
  // one student since a point in time, regardless of which feature (generation or evaluation)
  // spent it.
  async sumCostForStudentSince(db: Db, studentId: string, since: Date): Promise<number> {
    const row = await db
      .selectFrom('ai_jobs')
      .select(sql<string>`coalesce(sum(cost_inr), 0)`.as('total'))
      .where('student_id', '=', studentId)
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow()
    return Number(row.total)
  },
  // F091: "dashboard by day, feature and student." One row per bucket in the requested
  // dimension, summed over [from, to]. A pending/error row (no tokens/cost yet) still counts
  // toward `calls` and `error_count` so a string of failures shows up even before it costs
  // anything -- the point of the dashboard per its own user story ("costs do not run away").
  async aggregateUsage(
    db: Db,
    input: { from: Date; to: Date | null; groupBy: AiUsageGroupBy },
  ): Promise<Array<AiUsageAggregateRow>> {
    const groupExpr = aiUsageGroupExpr(input.groupBy)
    let query = db
      .selectFrom('ai_jobs')
      .select([
        groupExpr.as('group_key'),
        sql<string>`count(*)`.as('calls'),
        sql<string>`coalesce(sum(tokens_in), 0)`.as('tokens_in'),
        sql<string>`coalesce(sum(tokens_out), 0)`.as('tokens_out'),
        sql<string>`coalesce(sum(cost_inr), 0)`.as('cost_inr'),
        sql<string | null>`avg(latency_ms)`.as('avg_latency_ms'),
        sql<string>`count(*) filter (where status = 'error')`.as('error_count'),
      ])
      .where('created_at', '>=', input.from)
    if (input.to !== null) {
      query = query.where('created_at', '<=', input.to)
    }
    const rows = await query.groupBy(groupExpr).orderBy(groupExpr).execute()

    return rows.map((r) => ({
      group_key: r.group_key,
      calls: Number(r.calls),
      tokens_in: Number(r.tokens_in),
      tokens_out: Number(r.tokens_out),
      cost_inr: Number(r.cost_inr),
      avg_latency_ms: r.avg_latency_ms == null ? null : Number(r.avg_latency_ms),
      error_count: Number(r.error_count),
    }))
  },
  async totalsForRange(
    db: Db,
    input: { from: Date; to: Date | null },
  ): Promise<Omit<AiUsageAggregateRow, 'group_key' | 'avg_latency_ms'>> {
    let query = db
      .selectFrom('ai_jobs')
      .select([
        sql<string>`count(*)`.as('calls'),
        sql<string>`coalesce(sum(tokens_in), 0)`.as('tokens_in'),
        sql<string>`coalesce(sum(tokens_out), 0)`.as('tokens_out'),
        sql<string>`coalesce(sum(cost_inr), 0)`.as('cost_inr'),
        sql<string>`count(*) filter (where status = 'error')`.as('error_count'),
      ])
      .where('created_at', '>=', input.from)
    if (input.to !== null) {
      query = query.where('created_at', '<=', input.to)
    }
    const row = await query.executeTakeFirstOrThrow()

    return {
      calls: Number(row.calls),
      tokens_in: Number(row.tokens_in),
      tokens_out: Number(row.tokens_out),
      cost_inr: Number(row.cost_inr),
      error_count: Number(row.error_count),
    }
  },
}

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
