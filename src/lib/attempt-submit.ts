import type { Db } from '../db/connection'
import { attemptsRepository } from '../db/repositories'
import { logProductEvent } from './product-events'
import { autoConfirmAttempt } from './adaptive/auto-confirm'
import { getPointsEarnedForEvaluation } from './points'

type Attempt = NonNullable<Awaited<ReturnType<typeof attemptsRepository.findById>>>

/**
 * Closes an in-progress attempt: marks it submitted, logs the funnel event, and runs adaptive
 * auto-confirmation. Shared by POST /api/attempts/:id/submit (the student's Submit button) and the
 * F050-F053 scan flow's final step, so a paper written by hand ends up exactly where a typed one
 * does. The caller has already checked access, that the attempt is in progress, and blanks.
 */
export async function submitAttempt(
  db: Db,
  attempt: Attempt,
  student: { id: string; household_id: string },
) {
  const durationUsedSec = Math.floor(
    (Date.now() - new Date(attempt.started_at).getTime()) / 1000,
  )
  const updated = await attemptsRepository.update(db, student.id, attempt.id, {
    status: 'submitted',
    submitted_at: new Date(),
    duration_used_sec: durationUsedSec,
  })

  await logProductEvent(db, {
    eventType: 'attempt_submitted',
    householdId: student.household_id,
    studentId: student.id,
  })

  const outcome = await autoConfirmAttempt(db, attempt)
  const pointsEarned = outcome.evaluationId
    ? await getPointsEarnedForEvaluation(db, outcome.evaluationId)
    : null

  return {
    ...updated,
    evaluation_id: outcome.evaluationId,
    review_pending: outcome.reviewPending,
    points_earned: pointsEarned,
  }
}
