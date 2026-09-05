// Literal-union types for the text + CHECK constraint columns in src/db/migrations. Postgres
// CHECK constraints aren't introspectable as enums by kysely-codegen (unlike native enum types),
// so these are wired in via kysely-codegen.json's `overrides` + `customImports` to give the
// generated Database type real literal types instead of plain `string`. Keep this file in sync
// with the CHECK constraints by hand when a migration changes one.

export type UserRole = 'parent' | 'student' | 'admin'
export type ScopeKind = 'IN' | 'OUT'
export type DifficultyTier = 'Easy' | 'Hard' | 'Hardest'
export type BloomLevel =
  'Remember' | 'Understand' | 'Apply' | 'Analyse' | 'Evaluate' | 'Create'
export type QuestionType =
  | 'mcq'
  | 'assertion_reason'
  | 'match'
  | 'multi_statement'
  | 'short_answer'
  | 'long_answer'
  | 'fill_blank'
  | 'diagram'
export type QuestionStatus = 'draft' | 'approved' | 'retired'
export type AttemptMode = 'online' | 'uploaded'
export type AttemptStatus = 'in_progress' | 'submitted' | 'evaluated'
export type AnswerSource = 'typed' | 'ocr'
export type EvaluatedBy = 'ai' | 'human' | 'mixed'
export type HabitRating = 'present' | 'partial' | 'absent'
export type ConceptStatusValue =
  'Strong' | 'Needs Practice' | 'Weak' | 'Priority' | 'Maintenance'
export type RemediationStatus = 'pending' | 'in_progress' | 'completed'
export type StudyPlanStatus = 'active' | 'completed' | 'superseded'
export type UploadKind = 'scan' | 'source_pdf'
export type AiJobStatus = 'success' | 'error' | 'pending'
export type NotificationChannel = 'email' | 'whatsapp' | 'in_app'
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'read'
