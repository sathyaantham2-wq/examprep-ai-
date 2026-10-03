import type { Db } from '../db/connection'
import { studentActivityRepository } from '../db/repositories'

export type {
  ActivityDay,
  ActivityReport,
  ActivityStudentRow,
} from '../db/repositories/activity'
export {
  MAX_CONTINUOUS_GAP_SECONDS,
  RESUME_CREDIT_SECONDS,
} from '../db/repositories/activity'

/**
 * Credits one "she is here" ping to a student. Active time is the real time since her previous
 * ping when that was recent, otherwise one ping interval -- so pinging faster than every 30 s
 * adds nothing beyond the wall clock. Stored per day in India time; only a number of seconds is
 * kept, never what she was looking at.
 */
export function recordStudentPing(db: Db, studentId: string): Promise<void> {
  return studentActivityRepository.recordPing(db, studentId)
}

/** Admin report: how many students used the app, and for how long, over a trailing window. */
export function getStudentActivityReport(db: Db, windowDays: number) {
  return studentActivityRepository.getReport(db, windowDays)
}
