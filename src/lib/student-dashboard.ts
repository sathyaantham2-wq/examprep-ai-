import type { Db } from '../db/connection'

interface ChapterMastery {
  chapter_id: string
  chapter_name: string
  mastery_pct: number
}

interface FocusConcept {
  concept_id: string
  concept_name: string
}

export interface StudentDashboard {
  chapters: Array<ChapterMastery>
  streak_days: number
  today_focus: FocusConcept | null
  recent_improvements: Array<FocusConcept>
}

const MASTERED_STATUSES = new Set(['Strong', 'Maintenance'])
// Practice this before anything else it appears alongside — most urgent first. "Weak" and
// "Priority" both feed today_focus, but the raw status word is never shown to the student (F072:
// "no red shaming language") — only the concept name.
const FOCUS_PRIORITY: Record<string, number> = {
  Priority: 0,
  Weak: 1,
  'Needs Practice': 2,
}

/**
 * F072 (tab06 /student): "Mastery rings per chapter, streak, next drill, recent improvements; no
 * red shaming language." There's no remediation-pack entity yet (F066, M13 is Not Started), so
 * "next drill" is approximated as the single most urgent concept from the existing tracker
 * (F061-064) — real drill content is F066's job once it exists.
 */
export async function buildStudentDashboard(
  db: Db,
  studentId: string,
): Promise<StudentDashboard> {
  const statusRows = await db
    .selectFrom('concept_status')
    .innerJoin('concepts', 'concepts.id', 'concept_status.concept_id')
    .select([
      'concept_status.concept_id',
      'concept_status.status',
      'concept_status.trend',
      'concept_status.flagged_at',
      'concepts.name as concept_name',
      'concepts.chapter_id',
    ])
    .where('concept_status.student_id', '=', studentId)
    .execute()

  const chapterIds = [...new Set(statusRows.map((r) => r.chapter_id))]
  const chapters =
    chapterIds.length > 0
      ? await db
          .selectFrom('chapters')
          .select(['id', 'name'])
          .where('id', 'in', chapterIds)
          .execute()
      : []

  const allConceptsByChapter = new Map<string, number>()
  if (chapterIds.length > 0) {
    const rows = await db
      .selectFrom('concepts')
      .select(['chapter_id', (eb) => eb.fn.countAll<string>().as('count')])
      .where('chapter_id', 'in', chapterIds)
      .groupBy('chapter_id')
      .execute()
    for (const row of rows) allConceptsByChapter.set(row.chapter_id, Number(row.count))
  }

  const masteredByChapter = new Map<string, number>()
  for (const row of statusRows) {
    if (MASTERED_STATUSES.has(row.status)) {
      masteredByChapter.set(row.chapter_id, (masteredByChapter.get(row.chapter_id) ?? 0) + 1)
    }
  }

  const chapterMastery: Array<ChapterMastery> = chapters.map((c) => {
    const total = allConceptsByChapter.get(c.id) ?? 0
    const mastered = masteredByChapter.get(c.id) ?? 0
    return {
      chapter_id: c.id,
      chapter_name: c.name,
      mastery_pct: total > 0 ? Math.round((mastered / total) * 100) : 0,
    }
  })

  const focusCandidates = statusRows
    .filter((r) => r.status in FOCUS_PRIORITY)
    .sort((a, b) => FOCUS_PRIORITY[a.status] - FOCUS_PRIORITY[b.status])
  const todayFocus: FocusConcept | null = focusCandidates[0]
    ? { concept_id: focusCandidates[0].concept_id, concept_name: focusCandidates[0].concept_name }
    : null

  const recentImprovements: Array<FocusConcept> = statusRows
    .filter((r) => r.trend === 'up')
    .sort((a, b) => {
      const at = a.flagged_at ? new Date(a.flagged_at).getTime() : 0
      const bt = b.flagged_at ? new Date(b.flagged_at).getTime() : 0
      return bt - at
    })
    .slice(0, 3)
    .map((r) => ({ concept_id: r.concept_id, concept_name: r.concept_name }))

  const submittedAttempts = await db
    .selectFrom('attempts')
    .select('submitted_at')
    .where('student_id', '=', studentId)
    .where('submitted_at', 'is not', null)
    .execute()
  const streakDays = computeStreakDays(
    submittedAttempts
      .map((r) => r.submitted_at?.toISOString().slice(0, 10))
      .filter((d): d is string => Boolean(d)),
  )

  return {
    chapters: chapterMastery,
    streak_days: streakDays,
    today_focus: todayFocus,
    recent_improvements: recentImprovements,
  }
}

/** Consecutive calendar days ending today (or yesterday, so a streak survives until end of day)
 * with at least one submitted attempt. `days` are YYYY-MM-DD strings, any order. */
export function computeStreakDays(days: Array<string>): number {
  const daySet = new Set(days)
  if (daySet.size === 0) return 0

  const oneDayMs = 24 * 60 * 60 * 1000
  let cursor = new Date()
  cursor.setUTCHours(0, 0, 0, 0)
  const todayKey = cursor.toISOString().slice(0, 10)
  if (!daySet.has(todayKey)) {
    cursor = new Date(cursor.getTime() - oneDayMs)
  }

  let streak = 0
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streak += 1
    cursor = new Date(cursor.getTime() - oneDayMs)
  }
  return streak
}
