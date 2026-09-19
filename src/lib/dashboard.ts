import type { Db } from '../db/connection'
import {
  conceptStatusRepository,
  patternHitsRepository,
  remediationTasksRepository,
  habitDrillTasksRepository,
} from '../db/repositories'
import type { ConceptStatusValue } from '../db/enums'

interface PatternFrequency {
  pattern_id: string
  pattern_code: string
  pattern_name: string
  count: number
}

interface PriorityConcept {
  concept_id: string
  concept_name: string
  status: ConceptStatusValue
}

interface ScorePoint {
  date: string
  percentage: number
  delivery_gap: number
}

interface SubjectCard {
  subject_id: string
  subject_name: string
  latest_score: { percentage: number; delivery_gap: number } | null
  trend: 'up' | 'down' | 'flat' | null
  priority_concepts: Array<PriorityConcept>
  next_action: string
  // F050 (photo/PDF upload) isn't built yet -- always empty until that feature lands.
  pending_uploads: Array<never>
  // F075: "score-over-time per subject, Delivery Gap over time" -- oldest first (chart reading
  // order), capped at the most recent 20 confirmed evaluations so the payload doesn't grow
  // unbounded over a student's whole history.
  score_history: Array<ScorePoint>
}

interface LastPaperEvaluated {
  paper_title: string
  percentage: number
  confirmed_at: string
}

interface PendingItem {
  kind: 'remediation' | 'habit_drill'
  id: string
  label: string
}

interface SessionRecap {
  last_session_date: string | null
  last_paper_evaluated: LastPaperEvaluated | null
  // F076: the literal 'Priority' status, cross-subject -- distinct from a subject card's own
  // priority_concepts above, which also includes 'Weak' and is scoped to one subject.
  current_priority_concepts: Array<{
    concept_id: string
    concept_name: string
    subject_name: string
  }>
  pending_items: Array<PendingItem>
}

interface NeedsEvaluation {
  attempt_id: string
  paper_title: string
  submitted_at: string
}

const PRIORITY_ORDER: Record<string, number> = {
  Priority: 0,
  Weak: 1,
  'Needs Practice': 2,
  Maintenance: 3,
  Strong: 4,
}

/**
 * F071: "per subject: latest score, trend, Delivery Gap, top 3 priority concepts, next action,
 * pending uploads." Subjects come from whichever subjects this student has ever generated a
 * paper for (there's no separate "enrolled subjects" concept in the schema) -- for the current
 * single-subject launch scope that's just MATH-SEED, but this reads generally.
 */
export async function buildParentDashboard(db: Db, studentId: string) {
  const papers = await db
    .selectFrom('papers')
    .select('subject_id')
    .distinct()
    .where('student_id', '=', studentId)
    .execute()
  const subjectIds = papers.map((p) => p.subject_id)

  const subjects =
    subjectIds.length > 0
      ? await db
          .selectFrom('subjects')
          .select(['id', 'name'])
          .where('id', 'in', subjectIds)
          .execute()
      : []

  const cards: Array<SubjectCard> = []
  for (const subject of subjects) {
    const recentEvaluations = await db
      .selectFrom('evaluations')
      .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
      .innerJoin('papers', 'papers.id', 'attempts.paper_id')
      .select([
        'evaluations.percentage',
        'evaluations.delivery_gap',
        'evaluations.confirmed_at',
      ])
      .where('attempts.student_id', '=', studentId)
      .where('papers.subject_id', '=', subject.id)
      .where('evaluations.confirmed_at', 'is not', null)
      .orderBy('evaluations.confirmed_at', 'desc')
      .limit(20)
      .execute()

    const latest = recentEvaluations.at(0)
    const previous = recentEvaluations.at(1)
    const trend: SubjectCard['trend'] = !latest
      ? null
      : !previous
        ? 'flat'
        : Number(latest.percentage) > Number(previous.percentage)
          ? 'up'
          : Number(latest.percentage) < Number(previous.percentage)
            ? 'down'
            : 'flat'

    const statuses = await conceptStatusRepository.listForStudentWithFilter(
      db,
      studentId,
      {
        subjectId: subject.id,
      },
    )
    const priorityConcepts: Array<PriorityConcept> = statuses
      .filter((s) => s.status === 'Priority' || s.status === 'Weak')
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.status] ?? 9) - (PRIORITY_ORDER[b.status] ?? 9),
      )
      .slice(0, 3)
      .map((s) => ({
        concept_id: s.concept_id,
        concept_name: s.concept_name,
        status: s.status,
      }))

    const nextAction = priorityConcepts[0]
      ? `Practice ${priorityConcepts[0].concept_name} this week — currently ${priorityConcepts[0].status}.`
      : 'No priority or weak concepts flagged right now — keep up the current pace.'

    const scoreHistory: Array<ScorePoint> = recentEvaluations
      .filter((e) => e.confirmed_at)
      .slice()
      .reverse()
      .map((e) => ({
        date: e.confirmed_at!.toISOString().slice(0, 10),
        percentage: Number(e.percentage),
        delivery_gap: Number(e.delivery_gap),
      }))

    cards.push({
      subject_id: subject.id,
      subject_name: subject.name,
      latest_score: latest
        ? {
            percentage: Number(latest.percentage),
            delivery_gap: Number(latest.delivery_gap),
          }
        : null,
      trend,
      priority_concepts: priorityConcepts,
      next_action: nextAction,
      pending_uploads: [],
      score_history: scoreHistory,
    })
  }

  const statusCounts = await db
    .selectFrom('concept_status')
    .select(['status', (eb) => eb.fn.countAll<string>().as('count')])
    .where('student_id', '=', studentId)
    .groupBy('status')
    .execute()
  const conceptStatusDistribution = Object.fromEntries(
    statusCounts.map((row) => [row.status, Number(row.count)]),
  ) as Record<ConceptStatusValue, number>

  // F065: "patterns ... aggregated across all subjects" -- the counterpart to habit ratings
  // (already cross-subject by construction, see habitObservationsRepository.trendForStudent),
  // surfaced on the same dashboard rather than a new screen.
  const patternRows = await patternHitsRepository.countForStudent(db, studentId)
  const patternFrequency: Array<PatternFrequency> = patternRows.map((row) => ({
    pattern_id: row.pattern_id,
    pattern_code: row.pattern_code,
    pattern_name: row.pattern_name,
    count: Number(row.count),
  }))

  // F076: "On login: last session date, last paper evaluated, current priority concepts, pending
  // items." A "session" is any attempt this student has started -- the earliest real signal of
  // "they showed up," distinct from when a parent later reviews/confirms it.
  const lastAttempt = await db
    .selectFrom('attempts')
    .select('started_at')
    .where('student_id', '=', studentId)
    .orderBy('started_at', 'desc')
    .executeTakeFirst()

  const lastEvaluated = await db
    .selectFrom('evaluations')
    .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
    .innerJoin('papers', 'papers.id', 'attempts.paper_id')
    .select([
      'papers.title as paper_title',
      'evaluations.percentage',
      'evaluations.confirmed_at',
    ])
    .where('attempts.student_id', '=', studentId)
    .where('evaluations.confirmed_at', 'is not', null)
    .orderBy('evaluations.confirmed_at', 'desc')
    .executeTakeFirst()

  // F123 follow-on: the same missing-discoverability pattern as the papers-to-attempt list, one
  // step further down the pipeline -- a submitted attempt with no confirmed evaluation had no UI
  // anywhere pointing a parent/admin at /evaluate/:attemptId, discovered live right after the
  // papers list shipped. "Not yet evaluated" means no CONFIRMED evaluation exists -- an
  // unconfirmed AI-proposed evaluation still needs a human to finish it, so it counts too.
  const needsEvaluationRows = await db
    .selectFrom('attempts')
    .leftJoin('evaluations', (join) =>
      join
        .onRef('evaluations.attempt_id', '=', 'attempts.id')
        .on('evaluations.confirmed_at', 'is not', null),
    )
    .innerJoin('papers', 'papers.id', 'attempts.paper_id')
    .select([
      'attempts.id as attempt_id',
      'papers.title as paper_title',
      'attempts.submitted_at',
    ])
    .where('attempts.student_id', '=', studentId)
    .where('attempts.status', '=', 'submitted')
    .where('evaluations.id', 'is', null)
    .orderBy('attempts.submitted_at', 'asc')
    .execute()
  const needsEvaluation: Array<NeedsEvaluation> = needsEvaluationRows.map(
    (row) => ({
      attempt_id: row.attempt_id,
      paper_title: row.paper_title,
      submitted_at: row.submitted_at!.toISOString(),
    }),
  )

  const allStatuses = await conceptStatusRepository.listForStudentWithFilter(
    db,
    studentId,
    {},
  )
  const currentPriorityConcepts = allStatuses
    .filter((s) => s.status === 'Priority')
    .map((s) => ({
      concept_id: s.concept_id,
      concept_name: s.concept_name,
      subject_name:
        subjects.find((sub) => sub.id === s.subject_id)?.name ?? 'Unknown',
    }))

  const [remediationTasks, habitDrillTasks] = await Promise.all([
    remediationTasksRepository.listForStudent(db, studentId),
    habitDrillTasksRepository.listForStudent(db, studentId),
  ])
  const pendingItems: Array<PendingItem> = [
    ...remediationTasks
      .filter((t) => t.status !== 'completed')
      .map((t) => ({
        kind: 'remediation' as const,
        id: t.id,
        label: `Remediation drill: ${t.concept_name}`,
      })),
    ...habitDrillTasks
      .filter((t) => t.status === 'pending')
      .map((t) => ({
        kind: 'habit_drill' as const,
        id: t.id,
        label: `Habit drill: ${t.habit_name}`,
      })),
  ]

  const recap: SessionRecap = {
    last_session_date: lastAttempt?.started_at
      ? lastAttempt.started_at.toISOString().slice(0, 10)
      : null,
    last_paper_evaluated: lastEvaluated
      ? {
          paper_title: lastEvaluated.paper_title,
          percentage: Number(lastEvaluated.percentage),
          confirmed_at: lastEvaluated.confirmed_at!.toISOString(),
        }
      : null,
    current_priority_concepts: currentPriorityConcepts,
    pending_items: pendingItems,
  }

  return {
    subjects: cards,
    concept_status_distribution: conceptStatusDistribution,
    pattern_frequency: patternFrequency,
    recap,
    needs_evaluation: needsEvaluation,
  }
}
