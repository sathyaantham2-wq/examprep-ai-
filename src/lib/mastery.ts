import type { Db } from '../db/connection'
import type { ConceptStatusValue } from '../db/enums'
import {
  conceptMasteryRepository,
  conceptStatusRepository,
} from '../db/repositories'

// F062: status thresholds on the ratio for THIS attempt/appearance, before the F063 escalation
// overrides below are applied. Configurable in the sense that these are the one place they live.
export const STRONG_THRESHOLD = 0.8
export const NEEDS_PRACTICE_THRESHOLD = 0.5
export const MAINTENANCE_RECOVERY_THRESHOLD = 0.85

export function computeRawStatus(ratio: number): ConceptStatusValue {
  if (ratio >= STRONG_THRESHOLD) return 'Strong'
  if (ratio >= NEEDS_PRACTICE_THRESHOLD) return 'Needs Practice'
  return 'Weak'
}

export function computeTrend(
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
export const RETEST_DAYS_BY_STATUS: Record<ConceptStatusValue, number> = {
  Priority: 3,
  Weak: 5,
  'Needs Practice': 10,
  Strong: 21,
  Maintenance: 30,
}

/**
 * F063's whole state machine, as a pure function so it's directly unit-testable (T18/T19)
 * without a database: Priority is sticky — it only clears via two consecutive >=85% attempts
 * (isTwoHighInARow), never by a single good score, which is why this checks the *persisted*
 * concept_status.status rather than just the last ledger row's label.
 *
 * F063's "retire only after three" doesn't map onto a schema value: concept_status.status is a
 * fixed five-value CHECK (Strong/Needs Practice/Weak/Priority/Maintenance) with no "Retired"
 * option, and inventing one wasn't part of this pass's scope. The "auto-triggers a 5-question
 * mini test" half of F063 also isn't implemented — that needs the paper generator to be invoked
 * from here, which would make this impure; left as a TODO for whatever calls this once a
 * Priority flag is newly raised.
 */
export function determineNextStatus(params: {
  ratio: number
  mostRecentRatio: number | undefined
  mostRecentStatus: ConceptStatusValue | undefined
  currentPersistedStatus: ConceptStatusValue | undefined
}): ConceptStatusValue {
  const isTwoHighInARow =
    params.ratio >= MAINTENANCE_RECOVERY_THRESHOLD &&
    params.mostRecentRatio !== undefined &&
    params.mostRecentRatio >= MAINTENANCE_RECOVERY_THRESHOLD

  if (isTwoHighInARow) return 'Maintenance'
  if (params.currentPersistedStatus === 'Priority') return 'Priority'

  const raw = computeRawStatus(params.ratio)
  if (raw === 'Weak' && params.mostRecentStatus === 'Weak') return 'Priority'
  return raw
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
  // determineNextStatus needs this to keep Priority sticky across a single good score.
  const existing = await conceptStatusRepository.findOne(
    db,
    input.student_id,
    input.concept_id,
  )

  const status = determineNextStatus({
    ratio,
    mostRecentRatio: mostRecent ? Number(mostRecent.ratio) : undefined,
    mostRecentStatus: mostRecent?.status_at_time ?? undefined,
    currentPersistedStatus: existing?.status,
  })

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
