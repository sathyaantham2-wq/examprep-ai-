import type { Db } from '../db/connection'
import { conceptMasteryRepository } from '../db/repositories'

interface SubjectWeekScore {
  subject_id: string
  subject_name: string
  avg_percentage: number
  evaluations_count: number
}

interface ImprovedConcept {
  concept_id: string
  concept_name: string
  delta: number
}

interface UrgentConcept {
  concept_id: string
  concept_name: string
}

interface CumulativeStats {
  this_week: { evaluations_count: number; avg_percentage: number | null }
  last_week: { evaluations_count: number; avg_percentage: number | null }
}

export interface WeeklySummary {
  week_start: string
  week_end: string
  best_subject: SubjectWeekScore | null
  most_improved_concept: ImprovedConcept | null
  urgent_concept: UrgentConcept | null
  seven_day_plan: Array<UrgentConcept>
  cumulative_stats: CumulativeStats
}

const FOCUS_PRIORITY: Record<string, number> = {
  Priority: 0,
  Weak: 1,
  'Needs Practice': 2,
}

async function subjectScoresInWindow(db: Db, studentId: string, start: Date, end: Date) {
  return db
    .selectFrom('evaluations')
    .innerJoin('attempts', 'attempts.id', 'evaluations.attempt_id')
    .innerJoin('papers', 'papers.id', 'attempts.paper_id')
    .innerJoin('subjects', 'subjects.id', 'papers.subject_id')
    .select([
      'subjects.id as subject_id',
      'subjects.name as subject_name',
      'evaluations.percentage',
    ])
    .where('attempts.student_id', '=', studentId)
    .where('evaluations.confirmed_at', 'is not', null)
    .where('evaluations.confirmed_at', '>=', start)
    .where('evaluations.confirmed_at', '<', end)
    .execute()
}

/**
 * F074 (tab05 GET /api/summary/weekly/:studentId?week_start=): "best subject, most improved
 * concept, urgent concept, 7-day study plan, cumulative stats vs last week." The AC's "auto every
 * 7 active days" trigger belongs to M16 (notifications), which doesn't exist yet — this builds
 * the summary for a given window on request; a future notification job calls this the same way a
 * screen does. `seven_day_plan` is a lightweight stand-in (the same priority-concept list the
 * dashboards already use) until F077's dedicated planner exists.
 */
export async function buildWeeklySummary(
  db: Db,
  studentId: string,
  weekStart: Date,
): Promise<WeeklySummary> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [thisWeekRows, lastWeekRows] = await Promise.all([
    subjectScoresInWindow(db, studentId, weekStart, weekEnd),
    subjectScoresInWindow(db, studentId, prevWeekStart, weekStart),
  ])

  const bySubject = new Map<string, { name: string; scores: Array<number> }>()
  for (const row of thisWeekRows) {
    const entry = bySubject.get(row.subject_id) ?? { name: row.subject_name, scores: [] }
    entry.scores.push(Number(row.percentage))
    bySubject.set(row.subject_id, entry)
  }
  let bestSubject: SubjectWeekScore | null = null
  for (const [subjectId, entry] of bySubject) {
    const avg = entry.scores.reduce((s, v) => s + v, 0) / entry.scores.length
    if (!bestSubject || avg > bestSubject.avg_percentage) {
      bestSubject = {
        subject_id: subjectId,
        subject_name: entry.name,
        avg_percentage: Math.round(avg),
        evaluations_count: entry.scores.length,
      }
    }
  }

  const avgOf = (rows: Array<{ percentage: string | number | null }>) =>
    rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + Number(r.percentage ?? 0), 0) / rows.length)
      : null

  const cumulativeStats: CumulativeStats = {
    this_week: { evaluations_count: thisWeekRows.length, avg_percentage: avgOf(thisWeekRows) },
    last_week: { evaluations_count: lastWeekRows.length, avg_percentage: avgOf(lastWeekRows) },
  }

  // concept_mastery.date is a DATE column (no time-of-day). weekEnd is often exactly "now", whose
  // calendar day already has real rows on it -- comparing that day against a timestamptz instant
  // collapses to date-vs-date and a strict `<` would wrongly exclude today's own entries. Working
  // in plain YYYY-MM-DD strings with an end boundary bumped one day forward makes "today counts as
  // part of this week" explicit instead of an accidental cast artifact.
  const weekStartDate = weekStart.toISOString().slice(0, 10)
  const weekEndDateExclusive = new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const thisWeekMastery = await conceptMasteryRepository.listForStudentInDateWindow(
    db,
    studentId,
    weekStartDate,
    weekEndDateExclusive,
  )

  let mostImproved: ImprovedConcept | null = null
  for (const row of thisWeekMastery) {
    const priorRow = await conceptMasteryRepository.findMostRecentBeforeDate(
      db,
      studentId,
      row.concept_id,
      weekStartDate,
    )
    if (!priorRow) continue
    const delta = Number(row.ratio) - Number(priorRow.ratio)
    if (delta > 0 && (!mostImproved || delta > mostImproved.delta)) {
      mostImproved = {
        concept_id: row.concept_id,
        concept_name: row.concept_name,
        delta: Math.round(delta * 100),
      }
    }
  }

  const statusRows = await db
    .selectFrom('concept_status')
    .innerJoin('concepts', 'concepts.id', 'concept_status.concept_id')
    .select(['concept_status.concept_id', 'concept_status.status', 'concepts.name as concept_name'])
    .where('concept_status.student_id', '=', studentId)
    .execute()

  const focusCandidates = statusRows
    .filter((r) => r.status in FOCUS_PRIORITY)
    .sort((a, b) => FOCUS_PRIORITY[a.status] - FOCUS_PRIORITY[b.status])

  const urgentConcept: UrgentConcept | null = focusCandidates[0]
    ? { concept_id: focusCandidates[0].concept_id, concept_name: focusCandidates[0].concept_name }
    : null

  const sevenDayPlan: Array<UrgentConcept> = focusCandidates
    .slice(0, 5)
    .map((r) => ({ concept_id: r.concept_id, concept_name: r.concept_name }))

  return {
    week_start: weekStart.toISOString().slice(0, 10),
    week_end: weekEnd.toISOString().slice(0, 10),
    best_subject: bestSubject,
    most_improved_concept: mostImproved,
    urgent_concept: urgentConcept,
    seven_day_plan: sevenDayPlan,
    cumulative_stats: cumulativeStats,
  }
}
