import type { Db } from '../db/connection'
import type { ConceptStatusValue, DifficultyTier } from '../db/enums'

export interface QuestionStats {
  question_id: string
  attempts: number
  success_rate: number | null
  mean_time_sec: number | null
  success_rate_by_mastery: Partial<Record<ConceptStatusValue, number>>
  anomaly: { flagged: boolean; reasons: Array<string> }
}

// F118: no anomaly threshold is defined anywhere in the plan -- these are a stated, reasonable
// default (a "too easy" Easy question or a "too hard" Hardest one is the clearest signal
// something's wrong with the item itself, not the students), not a spec value. Only fires once
// there's enough data to mean something -- 5 attempts is arbitrary but keeps a single fluke from
// flagging a fresh question.
const MIN_ATTEMPTS_FOR_ANOMALY = 5
const LOW_SUCCESS_THRESHOLD_EASY = 30
const HIGH_SUCCESS_THRESHOLD_HARDEST = 90

/**
 * F118: "Questions carry live stats (attempts, success rate by mastery level, mean time)."
 * success_rate_by_mastery is keyed by the answering student's CURRENT concept_status, not their
 * status at the time of that specific attempt (no historical snapshot of status-per-attempt
 * exists anywhere in this schema) -- a documented approximation, not the literal AC.
 */
export async function computeQuestionStats(db: Db, questionId: string): Promise<QuestionStats> {
  const question = await db
    .selectFrom('questions')
    .select(['id', 'difficulty', 'concept_id'])
    .where('id', '=', questionId)
    .executeTakeFirstOrThrow()

  const rows = await db
    .selectFrom('evaluation_items')
    .innerJoin('paper_questions', 'paper_questions.id', 'evaluation_items.paper_question_id')
    .innerJoin('evaluations', 'evaluations.id', 'evaluation_items.evaluation_id')
    .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
    .leftJoin('attempt_answers', (join) =>
      join
        .onRef('attempt_answers.attempt_id', '=', 'attempts.id')
        .onRef('attempt_answers.paper_question_id', '=', 'paper_questions.id'),
    )
    .select([
      'evaluation_items.marks_awarded',
      'evaluation_items.marks_max',
      'attempt_answers.time_spent_sec',
      'attempts.student_id',
    ])
    .where('paper_questions.question_id', '=', questionId)
    .execute()

  const attempts = rows.length
  if (attempts === 0) {
    return {
      question_id: questionId,
      attempts: 0,
      success_rate: null,
      mean_time_sec: null,
      success_rate_by_mastery: {},
      anomaly: { flagged: false, reasons: [] },
    }
  }

  // "Success" means full marks on this item, not a partial-credit ratio -- a clean binary
  // definition to flag on, and consistent with how F118's Easy/Hardest anomaly rules below read.
  const fullMarksCount = rows.filter(
    (r) => Number(r.marks_awarded) === Number(r.marks_max),
  ).length
  const successRate = Math.round((fullMarksCount / attempts) * 1000) / 10

  const timedRows = rows.filter((r) => r.time_spent_sec !== null)
  const meanTimeSec =
    timedRows.length > 0
      ? Math.round(
          timedRows.reduce((sum, r) => sum + Number(r.time_spent_sec), 0) / timedRows.length,
        )
      : null

  // concept_status is keyed by (student_id, concept_id) -- fetched separately per distinct
  // student rather than joined above, since this question's concept_id is fixed and known.
  const studentIds = [...new Set(rows.map((r) => r.student_id))]
  const statuses =
    studentIds.length > 0
      ? await db
          .selectFrom('concept_status')
          .select(['student_id', 'status'])
          .where('concept_id', '=', question.concept_id)
          .where('student_id', 'in', studentIds)
          .execute()
      : []
  const statusByStudent = new Map(statuses.map((s) => [s.student_id, s.status]))

  const byMastery = new Map<ConceptStatusValue, { total: number; full: number }>()
  for (const row of rows) {
    const status = statusByStudent.get(row.student_id)
    if (!status) continue
    const bucket = byMastery.get(status) ?? { total: 0, full: 0 }
    bucket.total += 1
    if (Number(row.marks_awarded) === Number(row.marks_max)) bucket.full += 1
    byMastery.set(status, bucket)
  }
  const successRateByMastery: Partial<Record<ConceptStatusValue, number>> = {}
  for (const [status, bucket] of byMastery) {
    successRateByMastery[status] = Math.round((bucket.full / bucket.total) * 1000) / 10
  }

  const reasons: Array<string> = []
  if (attempts >= MIN_ATTEMPTS_FOR_ANOMALY) {
    const difficulty: DifficultyTier = question.difficulty
    if (difficulty === 'Easy' && successRate < LOW_SUCCESS_THRESHOLD_EASY) {
      reasons.push(
        `Marked Easy but only ${successRate}% of ${attempts} attempts scored full marks`,
      )
    }
    if (difficulty === 'Hardest' && successRate > HIGH_SUCCESS_THRESHOLD_HARDEST) {
      reasons.push(
        `Marked Hardest but ${successRate}% of ${attempts} attempts scored full marks`,
      )
    }
  }

  return {
    question_id: questionId,
    attempts,
    success_rate: successRate,
    mean_time_sec: meanTimeSec,
    success_rate_by_mastery: successRateByMastery,
    anomaly: { flagged: reasons.length > 0, reasons },
  }
}
