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

export const auditLogRepository = createScopedRepository(
  'audit_log',
  'household_id',
)
