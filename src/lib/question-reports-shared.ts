// F129: report reasons and limits, shared by the server (question-reports.ts) and the browser
// (components/report-problem.tsx) -- kept free of server imports so the UI can use it.

export const REPORT_REASONS = [
  'marked_wrong',
  'question_error',
  'answer_error',
  'unclear',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  marked_wrong: 'My answer is right but was marked wrong',
  question_error: 'The question has a mistake',
  answer_error: 'The answer key has a mistake',
  unclear: 'The question is unclear',
  other: 'Something else',
}

export const REPORT_COMMENT_MIN = 3
export const REPORT_COMMENT_MAX = 300
