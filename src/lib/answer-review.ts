import type { Db } from '../db/connection'
import { auditLogRepository } from '../db/repositories'
import { autoConfirmAttempt } from './adaptive/auto-confirm'
import { reviewDisputedAnswer } from './ai-grading'
import { AiCapReachedError, StudentSpendCapReachedError, enforceStudentSpendBudget } from './ai-metering'
import { confirmEvaluation } from './evaluation'
import { isObjectiveType } from './scoring'

// How many written answers a student may question on one paper.
export const MAX_DISPUTES_PER_PAPER = 5
export const MIN_COMMENT_CHARS = 5
export const MAX_COMMENT_CHARS = 600

export type ReviewState = 'none' | 'waiting_for_parent' | 'review' | 'evaluated'

export interface ReviewItem {
  item_id: string
  position: number
  section: string
  concept_name: string | null
  question_text: string
  student_answer: string
  marks_awarded: number
  marks_max: number
  feedback: string | null
  dispute: {
    comment: string
    reply: string
    marks_before: number
    marks_after: number
  } | null
  excluded: boolean
}

export interface ReviewData {
  state: ReviewState
  evaluation_id: string | null
  disputes_used: number
  disputes_max: number
  written: Array<ReviewItem>
  // Multiple-choice marks are fixed by the answer key and cannot be questioned.
  objective: { marks: number; marks_max: number; count: number }
  total_now: number
  total_max: number
}

async function findEvaluation(db: Db, attemptId: string) {
  return db
    .selectFrom('evaluations')
    .select(['id', 'confirmed_at'])
    .where('attempt_id', '=', attemptId)
    .executeTakeFirst()
}

async function loadItems(db: Db, evaluationId: string, attemptId: string) {
  return db
    .selectFrom('evaluation_items as ei')
    .innerJoin('paper_questions as pq', 'pq.id', 'ei.paper_question_id')
    .innerJoin('questions as q', 'q.id', 'pq.question_id')
    .innerJoin('concepts as c', 'c.id', 'q.concept_id')
    .leftJoin('attempt_answers as aa', (join) =>
      join.onRef('aa.paper_question_id', '=', 'pq.id').on('aa.attempt_id', '=', attemptId),
    )
    .leftJoin('answer_disputes as d', 'd.evaluation_item_id', 'ei.id')
    .select([
      'ei.id as item_id',
      'ei.marks_awarded',
      'ei.marks_max',
      'ei.ai_marks',
      'ei.feedback',
      'ei.excluded_by_student',
      'pq.position',
      'pq.section',
      'q.type',
      'q.text as question_text',
      'c.name as concept_name',
      'aa.response_text',
      'd.student_comment',
      'd.ai_reply',
      'd.marks_before',
      'd.marks_after',
    ])
    .where('ei.evaluation_id', '=', evaluationId)
    .orderBy('pq.position')
    .execute()
}

async function isAdaptivePaper(db: Db, paperId: string): Promise<boolean> {
  const paper = await db.selectFrom('papers').select('weighting').where('id', '=', paperId).executeTakeFirst()
  const weighting = paper?.weighting as { adaptive?: { enabled?: boolean } } | null
  return Boolean(weighting?.adaptive?.enabled)
}

/**
 * What the student sees after submitting: the multiple-choice total, and each written answer with
 * its mark and the AI's feedback (never the answer key). If the paper has no evaluation yet it is
 * marked now, which also covers a submit request that was cut short.
 */
export async function loadReview(
  db: Db,
  attempt: { id: string; paper_id: string; student_id: string; status: string },
): Promise<ReviewData> {
  const empty = (state: ReviewState): ReviewData => ({
    state,
    evaluation_id: null,
    disputes_used: 0,
    disputes_max: MAX_DISPUTES_PER_PAPER,
    written: [],
    objective: { marks: 0, marks_max: 0, count: 0 },
    total_now: 0,
    total_max: 0,
  })
  if (attempt.status === 'in_progress') return empty('none')

  let evaluation = await findEvaluation(db, attempt.id)
  if (!evaluation && (await isAdaptivePaper(db, attempt.paper_id))) {
    await autoConfirmAttempt(db, attempt)
    evaluation = await findEvaluation(db, attempt.id)
  }
  if (!evaluation) return empty('waiting_for_parent')

  const rows = await loadItems(db, evaluation.id, attempt.id)
  const written: Array<ReviewItem> = []
  const objective = { marks: 0, marks_max: 0, count: 0 }
  let totalNow = 0
  let totalMax = 0
  for (const row of rows) {
    const marks = Number(row.marks_awarded)
    const max = Number(row.marks_max)
    const excluded = row.excluded_by_student
    if (!excluded) {
      totalNow += marks
      totalMax += max
    }
    if (isObjectiveType(row.type)) {
      objective.marks += marks
      objective.marks_max += max
      objective.count += 1
      continue
    }
    written.push({
      item_id: row.item_id,
      position: row.position,
      section: row.section,
      concept_name: row.concept_name,
      question_text: row.question_text,
      student_answer: row.response_text ?? '',
      marks_awarded: marks,
      marks_max: max,
      feedback: row.feedback,
      dispute:
        row.student_comment !== null
          ? {
              comment: row.student_comment,
              reply: row.ai_reply ?? '',
              marks_before: Number(row.marks_before),
              marks_after: Number(row.marks_after),
            }
          : null,
      excluded,
    })
  }
  const disputesUsed = written.filter((w) => w.dispute).length

  if (evaluation.confirmed_at) {
    return { state: 'evaluated', evaluation_id: evaluation.id, disputes_used: disputesUsed, disputes_max: MAX_DISPUTES_PER_PAPER, written, objective, total_now: totalNow, total_max: totalMax }
  }

  // Only a paper the AI marked in full can be reviewed by the student; anything the AI could not
  // mark waits for a parent.
  const aiMarkedAll = rows
    .filter((r) => !isObjectiveType(r.type))
    .every((r) => r.ai_marks !== null)
  const canReview =
    written.length > 0 && aiMarkedAll && (await isAdaptivePaper(db, attempt.paper_id))
  return {
    state: canReview ? 'review' : 'waiting_for_parent',
    evaluation_id: evaluation.id,
    disputes_used: disputesUsed,
    disputes_max: MAX_DISPUTES_PER_PAPER,
    written,
    objective,
    total_now: totalNow,
    total_max: totalMax,
  }
}

export type ReviewActionError =
  | 'not_reviewable'
  | 'item_not_found'
  | 'already_disputed'
  | 'limit_reached'
  | 'not_disputed'
  | 'already_removed'
  | 'comment_length'
  | 'ai_unavailable'
  | 'ai_limit'
  | 'ai_failed'

export type DisputeResult =
  | {
      ok: true
      reply: string
      changed: boolean
      marks_before: number
      marks_after: number
      disputes_used: number
    }
  | { ok: false; error: ReviewActionError }

type AttemptRef = { id: string; paper_id: string; student_id: string; status: string }
type StudentRef = { id: string; household_id: string }

/**
 * The student questions one written mark. The AI looks again (generously, and it may only keep or
 * raise the mark), and the exchange is recorded. Each answer can be questioned once, and at most
 * MAX_DISPUTES_PER_PAPER answers on a paper. A failed AI call uses up nothing.
 */
export async function disputeAnswer(
  db: Db,
  input: { student: StudentRef; attempt: AttemptRef; itemId: string; comment: string },
): Promise<DisputeResult> {
  const comment = input.comment.trim()
  if (comment.length < MIN_COMMENT_CHARS || comment.length > MAX_COMMENT_CHARS) {
    return { ok: false, error: 'comment_length' }
  }
  const review = await loadReview(db, input.attempt)
  if (review.state !== 'review' || !review.evaluation_id) return { ok: false, error: 'not_reviewable' }

  const item = review.written.find((w) => w.item_id === input.itemId)
  if (!item) return { ok: false, error: 'item_not_found' }
  if (item.excluded) return { ok: false, error: 'already_removed' }
  if (item.dispute) return { ok: false, error: 'already_disputed' }
  if (review.disputes_used >= MAX_DISPUTES_PER_PAPER) return { ok: false, error: 'limit_reached' }

  const detail = await db
    .selectFrom('evaluation_items as ei')
    .innerJoin('paper_questions as pq', 'pq.id', 'ei.paper_question_id')
    .innerJoin('questions as q', 'q.id', 'pq.question_id')
    .select(['q.id as question_id', 'q.text', 'q.answer', 'ei.marks_awarded', 'ei.marks_max', 'ei.feedback'])
    .where('ei.id', '=', item.item_id)
    .executeTakeFirstOrThrow()
  const scheme = await db
    .selectFrom('question_step_marks')
    .select(['step_no', 'description', 'marks'])
    .where('question_id', '=', detail.question_id)
    .orderBy('step_no')
    .execute()

  let outcome
  try {
    await enforceStudentSpendBudget(db, { studentId: input.student.id })
    outcome = await reviewDisputedAnswer(db, {
      questionText: detail.text,
      expectedAnswer: detail.answer,
      marksMax: Number(detail.marks_max),
      stepMarks: scheme,
      studentResponse: item.student_answer,
      previousMarks: Number(detail.marks_awarded),
      previousFeedback: detail.feedback ?? '',
      studentComment: comment,
      householdId: input.student.household_id,
      studentId: input.student.id,
    })
  } catch (error) {
    if (error instanceof AiCapReachedError || error instanceof StudentSpendCapReachedError) {
      return { ok: false, error: 'ai_limit' }
    }
    return { ok: false, error: 'ai_failed' }
  }
  if (!outcome) return { ok: false, error: 'ai_unavailable' }

  const before = Number(detail.marks_awarded)
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('answer_disputes')
      .values({
        evaluation_item_id: item.item_id,
        student_id: input.student.id,
        student_comment: comment,
        ai_reply: outcome.reply,
        marks_before: before,
        marks_after: outcome.totalMarks,
      })
      .execute()
    if (outcome.changed) {
      await trx
        .updateTable('evaluation_items')
        .set({
          marks_awarded: outcome.totalMarks,
          ai_marks: outcome.totalMarks,
          step_marks_awarded: JSON.stringify(outcome.stepMarksAwarded),
        })
        .where('id', '=', item.item_id)
        .execute()
    }
  })

  return {
    ok: true,
    reply: outcome.reply,
    changed: outcome.changed,
    marks_before: before,
    marks_after: outcome.totalMarks,
    disputes_used: review.disputes_used + 1,
  }
}

export type RemoveResult =
  | { ok: true; total_now: number; total_max: number }
  | { ok: false; error: ReviewActionError }

/** After the AI has looked again and the student is still unhappy, she can take the question out. */
export async function removeAnswer(
  db: Db,
  input: { attempt: AttemptRef; itemId: string },
): Promise<RemoveResult> {
  const review = await loadReview(db, input.attempt)
  if (review.state !== 'review') return { ok: false, error: 'not_reviewable' }
  const item = review.written.find((w) => w.item_id === input.itemId)
  if (!item) return { ok: false, error: 'item_not_found' }
  if (item.excluded) return { ok: false, error: 'already_removed' }
  if (!item.dispute) return { ok: false, error: 'not_disputed' }

  await db
    .updateTable('evaluation_items')
    .set({ excluded_by_student: true, excluded_at: new Date() })
    .where('id', '=', item.item_id)
    .execute()
  const after = await loadReview(db, input.attempt)
  return { ok: true, total_now: after.total_now, total_max: after.total_max }
}

export type FinalizeResult =
  | { ok: true; evaluation_id: string }
  | { ok: false; error: ReviewActionError }

/** The student accepts the marks as they now stand. This is the moment they become final. */
export async function finalizeReview(
  db: Db,
  input: { student: StudentRef; attempt: AttemptRef },
): Promise<FinalizeResult> {
  const review = await loadReview(db, input.attempt)
  if (review.state !== 'review' || !review.evaluation_id) return { ok: false, error: 'not_reviewable' }
  const confirmed = await confirmEvaluation(db, review.evaluation_id)
  await auditLogRepository.insert(db, {
    household_id: input.student.household_id,
    actor_user_id: null,
    action: 'evaluation.student_finalized',
    entity: 'evaluations',
    entity_id: review.evaluation_id,
    before: null,
    after: JSON.stringify({
      disputes_used: review.disputes_used,
      removed: review.written.filter((w) => w.excluded).length,
      evaluation: confirmed,
    }),
  })
  return { ok: true, evaluation_id: review.evaluation_id }
}
