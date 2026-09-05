import type { Db } from '../db/connection'
import type { ConceptStatusValue } from '../db/enums'
import {
  conceptMasteryRepository,
  conceptStatusRepository,
} from '../db/repositories'

// F062: status thresholds on the ratio for THIS attempt/appearance, before the F063 escalation
// overrides below are applied. Configurable in the sense that these are the one place they live.
const STRONG_THRESHOLD = 0.8
const NEEDS_PRACTICE_THRESHOLD = 0.5
const MAINTENANCE_RECOVERY_THRESHOLD = 0.85

function computeRawStatus(ratio: number): ConceptStatusValue {
  if (ratio >= STRONG_THRESHOLD) return 'Strong'
  if (ratio >= NEEDS_PRACTICE_THRESHOLD) return 'Needs Practice'
  return 'Weak'
}

function computeTrend(
  currentRatio: number,
  priorRatios: Array<number>,
): 'up' | 'down' | 'flat' {
  if (priorRatios.length === 0) return 'flat'
  const avgPrior =
    priorRatios.reduce((sum, r) => sum + r, 0) / priorRatios.length
  if (currentRatio > avgPrior + 0.05) return 'up'
  if (currentRatio < avgPrior - 0.05) return 'down'
  return 'flat'
}

// Retest spacing is a reasonable default, not a number specified anywhere in the plan — the
// product hasn't decided exact intervals yet. Easy to change in one place once it does.
const RETEST_DAYS_BY_STATUS: Record<ConceptStatusValue, number> = {
  Priority: 3,
  Weak: 5,
  'Needs Practice': 10,
  Strong: 21,
  Maintenance: 30,
}

export interface RecordAttemptInput {
  student_id: string
  concept_id: string
  evaluation_id: string
  date: string
  marks: number
  marks_max: number
}

/**
 * The write path for F061 (append-only ledger) + F062 (status/trend) + F063 (priority escalation
 * / maintenance recovery). This is a service, not a route — nothing in the app can call it yet
 * because it's meant to run when an evaluation is confirmed (POST /api/evaluations/:id/confirm,
 * M09), which doesn't exist. M09 should call this once it does.
 *
 * F063's "retire only after three" doesn't map onto a schema value: concept_status.status is a
 * fixed five-value CHECK (Strong/Needs Practice/Weak/Priority/Maintenance) with no "Retired"
 * option, and inventing one wasn't part of this pass's scope. What's implemented: Weak on a
 * second consecutive appearance escalates to Priority, and two consecutive attempts >=85% recover
 * a Priority/Weak/Maintenance concept into Maintenance. The "auto-triggers a 5-question mini
 * test" half of F063 is not implemented — that needs the paper generator (M06), which doesn't
 * exist yet.
 */
export async function recordMasteryAttempt(db: Db, input: RecordAttemptInput) {
  const ratio = input.marks_max > 0 ? input.marks / input.marks_max : 0

  const priorHistory = await conceptMasteryRepository.listForConcept(
    db,
    input.student_id,
    input.concept_id,
    2,
  )
  const mostRecent = priorHistory.at(0)

  // Look up the PERSISTED status before this attempt, not just the last ledger row's label —
  // Priority must survive a single good score; it only clears via the explicit two-in-a-row
  // recovery below. Without this, one lucky attempt would silently un-flag a concept the parent
  // is supposed to be watching.
  const existing = await conceptStatusRepository.findOne(
    db,
    input.student_id,
    input.concept_id,
  )

  const isTwoHighInARow =
    ratio >= MAINTENANCE_RECOVERY_THRESHOLD &&
    mostRecent !== undefined &&
    Number(mostRecent.ratio) >= MAINTENANCE_RECOVERY_THRESHOLD

  let status: ConceptStatusValue
  if (isTwoHighInARow) {
    status = 'Maintenance'
  } else if (existing?.status === 'Priority') {
    status = 'Priority'
  } else {
    status = computeRawStatus(ratio)
    if (status === 'Weak' && mostRecent?.status_at_time === 'Weak') {
      status = 'Priority'
    }
  }

  const trend = computeTrend(
    ratio,
    priorHistory.map((row) => Number(row.ratio)),
  )

  const masteryRow = await conceptMasteryRepository.insert(db, {
    student_id: input.student_id,
    concept_id: input.concept_id,
    evaluation_id: input.evaluation_id,
    date: input.date,
    marks: input.marks,
    marks_max: input.marks_max,
    ratio,
    status_at_time: status,
  })

  const priorAvg = existing ? Number(existing.avg_ratio ?? 0) : 0
  const priorAttempts = existing?.attempts ?? 0
  const newAvg = (priorAvg * priorAttempts + ratio) / (priorAttempts + 1)
  const isNewlyFlagged =
    status === 'Priority' && existing?.status !== 'Priority'

  const retestDays = RETEST_DAYS_BY_STATUS[status]
  const nextRetestAt = new Date(Date.now() + retestDays * 24 * 60 * 60 * 1000)

  const conceptStatus = await conceptStatusRepository.upsert(db, {
    student_id: input.student_id,
    concept_id: input.concept_id,
    attempts: priorAttempts + 1,
    avg_ratio: newAvg,
    last_ratio: ratio,
    trend,
    status,
    flagged_at: isNewlyFlagged
      ? new Date()
      : (existing?.flagged_at ?? undefined),
    next_retest_at: nextRetestAt,
  })

  return { masteryRow, conceptStatus }
}
