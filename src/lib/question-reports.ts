import type { Db } from '../db/connection'

// F129: "Report a problem" with a question. See migration 0071 for the model. A report is
// feedback only -- it never changes a mark or retires a question on its own.

import {
  REPORT_COMMENT_MAX,
  REPORT_COMMENT_MIN,
} from './question-reports-shared'
import type { ReportReason } from './question-reports-shared'

export {
  REPORT_COMMENT_MAX,
  REPORT_COMMENT_MIN,
  REPORT_REASONS,
  REPORT_REASON_LABEL,
} from './question-reports-shared'
export type { ReportReason } from './question-reports-shared'

export type ReportError =
  'question_not_found' | 'already_reported' | 'comment_length'

export async function createQuestionReport(
  db: Db,
  input: {
    attempt: { id: string; paper_id: string }
    student: { id: string; household_id: string }
    paperQuestionId: string
    reason: ReportReason
    comment: string
  },
): Promise<{ ok: true; id: string } | { ok: false; error: ReportError }> {
  const comment = input.comment.trim()
  if (
    comment.length < REPORT_COMMENT_MIN ||
    comment.length > REPORT_COMMENT_MAX
  ) {
    return { ok: false, error: 'comment_length' }
  }
  // The question must belong to the paper this attempt is for -- a student can only report a
  // question she was actually given.
  const slot = await db
    .selectFrom('paper_questions')
    .select(['id', 'question_id'])
    .where('id', '=', input.paperQuestionId)
    .where('paper_id', '=', input.attempt.paper_id)
    .executeTakeFirst()
  if (!slot) return { ok: false, error: 'question_not_found' }

  const inserted = await db
    .insertInto('question_reports')
    .values({
      question_id: slot.question_id,
      paper_question_id: slot.id,
      attempt_id: input.attempt.id,
      student_id: input.student.id,
      household_id: input.student.household_id,
      reason: input.reason,
      comment,
    })
    .onConflict((oc) =>
      oc.constraint('question_reports_attempt_question_key').doNothing(),
    )
    .returning('id')
    .executeTakeFirst()
  if (!inserted) return { ok: false, error: 'already_reported' }
  return { ok: true, id: inserted.id }
}

/** The paper_question ids this attempt has already reported, so the UI can show "Reported". */
export async function listReportedForAttempt(
  db: Db,
  attemptId: string,
): Promise<Array<string>> {
  const rows = await db
    .selectFrom('question_reports')
    .select('paper_question_id')
    .where('attempt_id', '=', attemptId)
    .execute()
  return rows.map((r) => r.paper_question_id)
}

export interface AdminReportRow {
  id: string
  reason: string
  comment: string
  status: string
  created_at: Date
  question_id: string
  question_text: string
  question_type: string
  expected_answer: string
  student_answer: string | null
  marks_awarded: string | null
  marks_max: string | null
}

/**
 * Admin queue: each report with the question, its key, and what the student actually wrote.
 * Scoped to the admin's own household -- 'admin' in this app is a household member with an
 * elevated role, not a cross-tenant superadmin (see F083), and a report carries a student's own
 * answer and words, so another family's reports are never visible here (T02).
 */
export async function listReportsForAdmin(
  db: Db,
  householdId: string,
  status: 'open' | 'resolved' | 'dismissed' | 'all',
): Promise<Array<AdminReportRow>> {
  let query = db
    .selectFrom('question_reports as r')
    .innerJoin('questions as q', 'q.id', 'r.question_id')
    .leftJoin('attempt_answers as aa', (join) =>
      join
        .onRef('aa.attempt_id', '=', 'r.attempt_id')
        .onRef('aa.paper_question_id', '=', 'r.paper_question_id'),
    )
    .leftJoin('evaluations as e', 'e.attempt_id', 'r.attempt_id')
    .leftJoin('evaluation_items as ei', (join) =>
      join
        .onRef('ei.evaluation_id', '=', 'e.id')
        .onRef('ei.paper_question_id', '=', 'r.paper_question_id'),
    )
    .select([
      'r.id',
      'r.reason',
      'r.comment',
      'r.status',
      'r.created_at',
      'q.id as question_id',
      'q.text as question_text',
      'q.type as question_type',
      'q.answer as expected_answer',
      'aa.response_text',
      'aa.selected_option',
      'ei.marks_awarded',
      'ei.marks_max',
    ])
    .where('r.household_id', '=', householdId)
    .orderBy('r.created_at', 'desc')
    .limit(200)
  if (status !== 'all') query = query.where('r.status', '=', status)
  const rows = await query.execute()
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    comment: r.comment,
    status: r.status,
    created_at: r.created_at,
    question_id: r.question_id,
    question_text: r.question_text,
    question_type: r.question_type,
    expected_answer: r.expected_answer,
    student_answer: r.response_text ?? r.selected_option ?? null,
    marks_awarded: r.marks_awarded === null ? null : String(r.marks_awarded),
    marks_max: r.marks_max === null ? null : String(r.marks_max),
  }))
}

export async function setReportStatus(
  db: Db,
  householdId: string,
  id: string,
  status: 'open' | 'resolved' | 'dismissed',
): Promise<boolean> {
  const updated = await db
    .updateTable('question_reports')
    .set({ status, resolved_at: status === 'open' ? null : new Date() })
    .where('id', '=', id)
    .where('household_id', '=', householdId)
    .executeTakeFirst()
  return Number(updated.numUpdatedRows) > 0
}
