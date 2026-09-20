import type { Db } from '../../db/connection'
import { masteryConfigSchema, resolveMasteryConfig } from './config'
import type { MasteryConfig } from './config'
import { adaptiveLevel, clampLevel } from './levels'
import type { AdaptiveLevel } from './levels'
import {
  computeMastery,
  effectiveRetentionStatus,
  evolveRetention,
} from './engine'
import type {
  AnswerEvent,
  MasteryLevelName,
  RetentionState,
  RetentionStatus,
} from './engine'
import type { ConceptSignal } from './weights'

const CONFIG_KEY = 'config'

export async function loadMasteryConfig(db: Db): Promise<MasteryConfig> {
  const row = await db
    .selectFrom('mastery_settings')
    .select('value')
    .where('key', '=', CONFIG_KEY)
    .executeTakeFirst()
  return resolveMasteryConfig(row?.value)
}

/** Validates the merged result, so a bad admin edit can never leave the engine unusable. */
export async function saveMasteryConfig(
  db: Db,
  userId: string,
  patch: unknown,
): Promise<{ ok: true; config: MasteryConfig } | { ok: false; error: unknown }> {
  const current = await loadMasteryConfig(db)
  const merged = mergeDeep(current, patch)
  const parsed = masteryConfigSchema.safeParse(merged)
  if (!parsed.success) return { ok: false, error: parsed.error.flatten() }
  await db
    .insertInto('mastery_settings')
    .values({ key: CONFIG_KEY, value: JSON.stringify(parsed.data), updated_by: userId })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        value: JSON.stringify(parsed.data),
        updated_by: userId,
        updated_at: new Date(),
      }),
    )
    .execute()
  return { ok: true, config: parsed.data }
}

function mergeDeep(base: Record<string, unknown>, over: unknown): Record<string, unknown> {
  if (typeof over !== 'object' || over === null || Array.isArray(over)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const existing = base[key]
    out[key] =
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? mergeDeep(existing as Record<string, unknown>, value)
        : value
  }
  return out
}

const SECOND_MS = 1000

/**
 * Called when a human confirms an evaluation (the only moment marks become final), inside the
 * same transaction. Logs one row per attempted question, then recomputes each affected concept.
 * Safe to call again for the same evaluation: rows are unique per (evaluation, question slot).
 *
 * Questions marked "Not Attempted" are left out: a blank answer is no evidence about the concept
 * (it is a delivery habit, tracked by the habit system), and counting it as wrong would push a
 * student's level down for questions she never tried.
 */
export async function recordConfirmedAnswers(
  db: Db,
  evaluationId: string,
): Promise<{ conceptsUpdated: number }> {
  const config = await loadMasteryConfig(db)

  const evaluation = await db
    .selectFrom('evaluations')
    .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
    .select([
      'evaluations.id',
      'evaluations.attempt_id',
      'evaluations.confirmed_at',
      'attempts.student_id',
      'attempts.submitted_at',
    ])
    .where('evaluations.id', '=', evaluationId)
    .executeTakeFirstOrThrow()

  const items = await db
    .selectFrom('evaluation_items as ei')
    .innerJoin('paper_questions as pq', 'pq.id', 'ei.paper_question_id')
    .innerJoin('questions as q', 'q.id', 'pq.question_id')
    .leftJoin('attempt_answers as aa', (join) =>
      join
        .onRef('aa.paper_question_id', '=', 'pq.id')
        .on('aa.attempt_id', '=', evaluation.attempt_id),
    )
    .select([
      'ei.paper_question_id',
      'ei.marks_awarded',
      'ei.marks_max',
      'ei.error_type',
      'ei.excluded_by_student',
      'pq.position',
      'q.id as question_id',
      'q.concept_id',
      'q.bloom',
      'q.difficulty',
      'aa.time_spent_sec',
    ])
    .where('ei.evaluation_id', '=', evaluationId)
    .execute()

  const base = (evaluation.submitted_at ?? evaluation.confirmed_at ?? new Date()).getTime()

  const touched = new Set<string>()
  for (const item of items) {
    const max = Number(item.marks_max)
    if (max <= 0 || item.error_type === 'Not Attempted' || item.excluded_by_student) continue
    const awarded = Number(item.marks_awarded)
    await db
      .insertInto('concept_answer_log')
      .values({
        student_id: evaluation.student_id,
        concept_id: item.concept_id,
        question_id: item.question_id,
        evaluation_id: evaluationId,
        paper_question_id: item.paper_question_id,
        level: adaptiveLevel(item.bloom, item.difficulty),
        marks_awarded: awarded,
        marks_max: max,
        credit: Math.min(1, Math.max(0, awarded / max)),
        time_spent_sec: item.time_spent_sec,
        answered_at: new Date(base + item.position * SECOND_MS),
      })
      .onConflict((oc) => oc.columns(['evaluation_id', 'paper_question_id']).doNothing())
      .execute()
    touched.add(item.concept_id)
  }

  for (const conceptId of touched) {
    await recomputeConcept(db, evaluation.student_id, conceptId, evaluationId, config)
  }
  return { conceptsUpdated: touched.size }
}

/** Rebuilds one concept's performance row from its answer log. */
export async function recomputeConcept(
  db: Db,
  studentId: string,
  conceptId: string,
  evaluationId: string | null,
  config: MasteryConfig,
) {
  const rows = await db
    .selectFrom('concept_answer_log')
    .select(['question_id', 'evaluation_id', 'credit', 'level', 'time_spent_sec', 'answered_at'])
    .where('student_id', '=', studentId)
    .where('concept_id', '=', conceptId)
    .orderBy('answered_at')
    .execute()
  const events: Array<AnswerEvent> = rows.map((r) => ({
    questionId: r.question_id,
    assessmentId: r.evaluation_id,
    credit: Number(r.credit),
    level: clampLevel(r.level),
    timeSec: r.time_spent_sec,
    answeredAt: r.answered_at,
  }))
  const state = computeMastery(events, config)

  const concept = await db
    .selectFrom('concepts')
    .innerJoin('chapters', 'chapters.id', 'concepts.chapter_id')
    .select(['concepts.chapter_id', 'chapters.subject_id'])
    .where('concepts.id', '=', conceptId)
    .executeTakeFirstOrThrow()

  const previous = await db
    .selectFrom('student_concept_performance')
    .select(['mastery_level', 'retention_status', 'retention_stage', 'next_retention_at'])
    .where('student_id', '=', studentId)
    .where('concept_id', '=', conceptId)
    .executeTakeFirst()

  const thisAssessment = events.filter((e) => e.assessmentId === evaluationId)
  const assessmentRate = thisAssessment.length
    ? (thisAssessment.reduce((a, b) => a + b.credit, 0) / thisAssessment.length) * 100
    : 100
  const previousRetention: RetentionState | null = previous
    ? {
        stage: previous.retention_stage,
        nextAt: previous.next_retention_at,
        status: previous.retention_status as RetentionState['status'],
      }
    : null
  const retention = evolveRetention({
    previousLevel: (previous?.mastery_level as MasteryLevelName | undefined) ?? null,
    newLevel: state.masteryLevel,
    previous: previousRetention,
    assessedAt: state.lastAssessedAt ?? new Date(),
    assessmentRate,
    config,
  })

  const values = {
    subject_id: concept.subject_id,
    chapter_id: concept.chapter_id,
    mastery_score: state.masteryScore,
    mastery_level: state.masteryLevel,
    questions_attempted: state.questionsAttempted,
    correct_answers: state.correctAnswers,
    wrong_answers: state.wrongAnswers,
    accuracy: state.accuracy,
    recent_accuracy: state.recentAccuracy,
    difficulty_score: state.difficultyScore,
    consistency_score: state.consistencyScore,
    current_difficulty: state.currentLevel,
    hard_questions_correct: state.hardQuestionsCorrect,
    master_questions_correct: state.masterQuestionsCorrect,
    consecutive_correct: state.consecutiveCorrect,
    consecutive_wrong: state.consecutiveWrong,
    assessment_count: state.assessmentCount,
    avg_response_sec: state.avgResponseSec,
    last_assessed_at: state.lastAssessedAt,
    retention_status: retention.status === 'due' ? ('scheduled' as const) : retention.status,
    retention_stage: retention.stage,
    next_retention_at: retention.nextAt,
    evidence_met: state.evidence.met,
    evidence_blockers: JSON.stringify(state.evidence.blockers),
    components: JSON.stringify(state.components),
  }
  await db
    .insertInto('student_concept_performance')
    .values({ student_id: studentId, concept_id: conceptId, ...values })
    .onConflict((oc) =>
      oc.columns(['student_id', 'concept_id']).doUpdateSet({ ...values, updated_at: new Date() }),
    )
    .execute()

  if (evaluationId) {
    await db
      .insertInto('mastery_history')
      .values({
        student_id: studentId,
        concept_id: conceptId,
        evaluation_id: evaluationId,
        mastery_score: state.masteryScore,
        mastery_level: state.masteryLevel,
        current_difficulty: state.currentLevel,
        questions_attempted: state.questionsAttempted,
        accuracy: state.accuracy,
        recent_accuracy: state.recentAccuracy,
        difficulty_score: state.difficultyScore,
        consistency_score: state.consistencyScore,
        evidence_met: state.evidence.met,
        components: JSON.stringify({ ...state.components, blockers: state.evidence.blockers }),
      })
      .onConflict((oc) => oc.columns(['evaluation_id', 'concept_id']).doNothing())
      .execute()
  }
  return state
}

/** Replays a student's confirmed evaluations in order, e.g. to fill the new tables for history. */
export async function backfillStudent(db: Db, studentId: string) {
  const evaluations = await db
    .selectFrom('evaluations')
    .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
    .select('evaluations.id')
    .where('attempts.student_id', '=', studentId)
    .where('evaluations.confirmed_at', 'is not', null)
    .orderBy('evaluations.confirmed_at')
    .execute()
  for (const e of evaluations) await recordConfirmedAnswers(db, e.id)
  return evaluations.length
}

export interface ConceptPerformance {
  concept_id: string
  concept_name: string
  concept_code: string
  chapter_id: string
  subject_id: string
  mastery_score: number
  mastery_level: MasteryLevelName
  current_difficulty: AdaptiveLevel
  questions_attempted: number
  accuracy: number
  recent_accuracy: number
  consecutive_wrong: number
  assessment_count: number
  last_assessed_at: Date | null
  retention: RetentionStatus
  next_retention_at: Date | null
  evidence_met: boolean
  evidence_blockers: Array<string>
}

export async function listPerformance(
  db: Db,
  studentId: string,
  now: Date = new Date(),
): Promise<Array<ConceptPerformance>> {
  const rows = await db
    .selectFrom('student_concept_performance as p')
    .innerJoin('concepts as c', 'c.id', 'p.concept_id')
    .selectAll('p')
    .select(['c.name as concept_name', 'c.code as concept_code'])
    .where('p.student_id', '=', studentId)
    .execute()
  return rows.map((r) => ({
    concept_id: r.concept_id,
    concept_name: r.concept_name,
    concept_code: r.concept_code,
    chapter_id: r.chapter_id,
    subject_id: r.subject_id,
    mastery_score: Number(r.mastery_score),
    mastery_level: r.mastery_level as MasteryLevelName,
    current_difficulty: clampLevel(r.current_difficulty),
    questions_attempted: r.questions_attempted,
    accuracy: Number(r.accuracy),
    recent_accuracy: Number(r.recent_accuracy),
    consecutive_wrong: r.consecutive_wrong,
    assessment_count: r.assessment_count,
    last_assessed_at: r.last_assessed_at,
    retention: effectiveRetentionStatus(
      { status: r.retention_status as RetentionStatus, nextAt: r.next_retention_at },
      now,
    ),
    next_retention_at: r.next_retention_at,
    evidence_met: r.evidence_met,
    evidence_blockers: Array.isArray(r.evidence_blockers) ? (r.evidence_blockers as Array<string>) : [],
  }))
}

/** One signal per requested concept; a concept the student has never answered has no score. */
export async function signalsForConcepts(
  db: Db,
  studentId: string,
  conceptIds: Array<string>,
  now: Date = new Date(),
): Promise<Array<ConceptSignal>> {
  if (conceptIds.length === 0) return []
  const performance = await listPerformance(db, studentId, now)
  const byConcept = new Map(performance.map((p) => [p.concept_id, p]))
  return conceptIds.map((conceptId) => {
    const p = byConcept.get(conceptId)
    if (!p || p.questions_attempted === 0) {
      return {
        conceptId,
        masteryScore: null,
        masteryLevel: null,
        currentLevel: 1 as AdaptiveLevel,
        consecutiveWrong: 0,
        recentAccuracy: null,
        lastAssessedAt: null,
        retention: 'not_applicable' as RetentionStatus,
      }
    }
    return {
      conceptId,
      masteryScore: p.mastery_score,
      masteryLevel: p.mastery_level,
      currentLevel: p.current_difficulty,
      consecutiveWrong: p.consecutive_wrong,
      recentAccuracy: p.recent_accuracy,
      lastAssessedAt: p.last_assessed_at,
      retention: p.retention,
    }
  })
}
