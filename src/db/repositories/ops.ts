import type { Db } from '../connection'
import { createScopedRepository } from './factory'

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
