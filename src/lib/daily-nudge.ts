import type { Db } from '../db/connection'
import type { NudgeStatus } from '../db/enums'
import { dailyNudgesRepository } from '../db/repositories'
import { getRankedActions } from './diagnosis'

// F082: no priority/weak concepts flagged -- the same fallback wording buildDiagnosisReport's
// parentAction already uses for this exact case, kept identical on purpose.
const NO_ACTION_TEXT = 'No priority or weak concepts flagged right now — keep up the current pace.'

export interface DailyNudge {
  id: string
  student_id: string
  date: string
  concept_id: string | null
  action_text: string
  status: NudgeStatus
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * F082: "A single concrete action derived from the latest diagnosis, delivered once daily."
 * "Latest diagnosis" is the student's current tracker state (getRankedActions, the same
 * worst-first Priority/Weak ranking F059's diagnosis report and F018's prerequisite surfacing
 * already use), not any one specific evaluation. Idempotent: (student_id, date) is unique, so a
 * second call the same day returns the existing row untouched rather than generating a new
 * action or losing whatever done/skipped mark the parent already gave it -- the same
 * "update-in-place, never blind-insert" lesson F077's study plan generator already applies.
 */
export async function generateOrGetTodayNudge(db: Db, studentId: string): Promise<DailyNudge> {
  const today = toDateString(new Date())
  const existing = await dailyNudgesRepository.findForDate(db, studentId, today)
  if (existing) {
    return {
      id: existing.id,
      student_id: existing.student_id,
      date: today,
      concept_id: existing.concept_id,
      action_text: existing.action_text,
      status: existing.status as NudgeStatus,
    }
  }

  const ranked = await getRankedActions(db, studentId, 1)

  const created = await dailyNudgesRepository.insert(db, {
    student_id: studentId,
    date: today,
    concept_id: ranked.length > 0 ? ranked[0].concept_id : null,
    action_text: ranked.length > 0 ? ranked[0].action : NO_ACTION_TEXT,
  })

  return {
    id: created.id,
    student_id: created.student_id,
    date: today,
    concept_id: created.concept_id,
    action_text: created.action_text,
    status: created.status as NudgeStatus,
  }
}

export async function markNudgeStatus(
  db: Db,
  studentId: string,
  nudgeId: string,
  status: 'done' | 'skipped',
): Promise<DailyNudge | null> {
  const existing = await dailyNudgesRepository.findById(db, studentId, nudgeId)
  if (!existing) return null

  const updated = await dailyNudgesRepository.update(db, studentId, nudgeId, { status })
  return {
    id: updated.id,
    student_id: updated.student_id,
    date: toDateString(updated.date),
    concept_id: updated.concept_id,
    action_text: updated.action_text,
    status: updated.status as NudgeStatus,
  }
}
