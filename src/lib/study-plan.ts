import type { Db } from '../db/connection'
import { conceptStatusRepository, studyPlansRepository } from '../db/repositories'

export interface StudyPlanDay {
  day_number: number
  date: string
  subject_name: string | null
  concept_id: string | null
  concept_name: string | null
  activity: string
  // F079: "tickable." Starts false for a freshly-generated day. Regenerating the SAME week
  // (generateStudyPlan's update-in-place path) carries this forward by day_number rather than
  // resetting it -- a student who already ticked off Monday shouldn't lose that because the
  // parent regenerated the plan on Wednesday.
  completed: boolean
}

export interface StudyPlan {
  id: string
  student_id: string
  week_start: string
  days: Array<StudyPlanDay>
  status: string
}

const PRIORITY_ORDER: Record<string, number> = {
  Priority: 0,
  Weak: 1,
  'Needs Practice': 2,
  Maintenance: 3,
  Strong: 4,
}

// F077: "7 rows of subject + concept + activity." Not a set of activity types the plan
// specifies -- a documented default, the same kind THEME_PACKS/RETEST_LADDER_DAYS already are.
// Day 7 is deliberately lighter (a real weekly study rhythm needs one), overridden with an
// exam-specific message when an exam lands within the plan's own week.
const ACTIVITIES = [
  'Review the refresher and worked examples',
  'Attempt a short practice drill',
  'Redo the mistakes from your last attempt on this concept',
  'Take a mixed practice set',
  'Review this week’s weak spots',
  'Attempt a fresh practice paper',
  'Light review — skim your notes, no new questions',
] as const

function mostRecentMonday(from: Date): Date {
  const day = from.getUTCDay() // 0 = Sunday ... 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(from)
  monday.setUTCDate(from.getUTCDate() - diffToMonday)
  monday.setUTCHours(0, 0, 0, 0)
  return monday
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface TargetExam {
  name: string
  date: string
}

/**
 * F077: "Plan built from current weak/priority concepts and upcoming exam dates: 7 rows of
 * subject + concept + activity, regenerable." Regenerating for the same week supersedes the
 * previous active plan (the unique (student_id, week_start) constraint means there can only ever
 * be one row for that week anyway) rather than erroring or duplicating.
 */
export async function generateStudyPlan(
  db: Db,
  studentId: string,
): Promise<StudyPlan> {
  const now = new Date()
  const weekStart = mostRecentMonday(now)
  const weekStartStr = toDateString(weekStart)

  const statuses = await conceptStatusRepository.listForStudentWithFilter(
    db,
    studentId,
    {},
  )
  const candidates = [...statuses].sort(
    (a, b) => (PRIORITY_ORDER[a.status] ?? 9) - (PRIORITY_ORDER[b.status] ?? 9),
  )

  const subjectIds = [...new Set(candidates.map((c) => c.subject_id))]
  const subjects =
    subjectIds.length > 0
      ? await db
          .selectFrom('subjects')
          .select(['id', 'name'])
          .where('id', 'in', subjectIds)
          .execute()
      : []
  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]))

  const student = await db
    .selectFrom('students')
    .select('target_exams')
    .where('id', '=', studentId)
    .executeTakeFirstOrThrow()
  const targetExams = student.target_exams as unknown as Array<TargetExam>
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  const examThisWeek = targetExams.find((exam) => {
    const examDate = new Date(`${exam.date}T00:00:00.000Z`)
    return examDate >= weekStart && examDate <= weekEnd
  })

  const days: Array<StudyPlanDay> = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart)
    date.setUTCDate(weekStart.getUTCDate() + i)

    // Cycle through the candidate list (worst-first) so a student with fewer than 7 tracked
    // concepts still gets a full week rather than blank days; a student with none at all yet
    // gets a placeholder day rather than the plan silently failing to build.
    const candidate =
      candidates.length > 0 ? candidates[i % candidates.length] : undefined
    const isExamEve = Boolean(examThisWeek) && i === 6

    days.push({
      day_number: i + 1,
      date: toDateString(date),
      subject_name: candidate
        ? (subjectNameById.get(candidate.subject_id) ?? null)
        : null,
      concept_id: candidate?.concept_id ?? null,
      concept_name: candidate?.concept_name ?? null,
      activity: isExamEve
        ? `Final review before ${examThisWeek!.name} — ${candidate ? `focus on ${candidate.concept_name}` : 'go over your weak spots'}`
        : candidate
          ? ACTIVITIES[i]
          : 'Generate a paper first to get a personalised plan.',
      completed: false,
    })
  }

  // "Regenerable": (student_id, week_start) is unique regardless of status, so this week's own
  // row (if it already exists) is UPDATED in place rather than superseded-and-reinserted -- doing
  // the latter would collide with that same constraint. A stale plan from an earlier week that
  // never got regenerated is superseded instead, so there is only ever one current plan.
  await studyPlansRepository.supersedeOtherActiveWeeks(db, studentId, weekStartStr)

  const generatedFrom = JSON.stringify({
    concept_ids: candidates.map((c) => c.concept_id),
    generated_at: now.toISOString(),
    exam_this_week: examThisWeek ?? null,
  })

  const existingThisWeek = await studyPlansRepository.findForWeek(
    db,
    studentId,
    weekStartStr,
  )
  if (existingThisWeek) {
    const oldDays = existingThisWeek.days as unknown as Array<StudyPlanDay>
    const completedByDayNumber = new Map(
      oldDays.map((d) => [d.day_number, d.completed]),
    )
    for (const day of days) {
      day.completed = completedByDayNumber.get(day.day_number) ?? false
    }
  }

  const plan = existingThisWeek
    ? await studyPlansRepository.update(db, studentId, existingThisWeek.id, {
        days: JSON.stringify(days),
        generated_from: generatedFrom,
        status: 'active',
      })
    : await studyPlansRepository.insert(db, {
        student_id: studentId,
        week_start: weekStartStr,
        days: JSON.stringify(days),
        generated_from: generatedFrom,
        status: 'active',
      })

  return {
    id: plan.id,
    student_id: plan.student_id,
    week_start: weekStartStr,
    days,
    status: plan.status,
  }
}

export interface TaskListItem extends StudyPlanDay {
  // F079: "roll over when missed." True for a PAST day that was never ticked off -- it still
  // needs doing, so it reappears in today's list rather than silently vanishing once its own
  // date has passed. Today's own day always appears with is_rollover: false, whether or not it's
  // done yet; a future day never appears (nothing to do about it yet).
  is_rollover: boolean
}

/**
 * F079: "tickable, roll over when missed." A pure function over the plan's own days (given
 * "today" as a real YYYY-MM-DD string), so it's directly testable without a database.
 */
export function getTaskList(
  days: Array<StudyPlanDay>,
  todayDateStr: string,
): Array<TaskListItem> {
  const tasks: Array<TaskListItem> = []
  for (const day of days) {
    if (day.date === todayDateStr) {
      tasks.push({ ...day, is_rollover: false })
    } else if (day.date < todayDateStr && !day.completed) {
      tasks.push({ ...day, is_rollover: true })
    }
  }
  return tasks
}

/**
 * F079: "completion feeds the weekly summary." The write side of "tickable" -- flips one day's
 * completed flag by day_number and persists the whole days array back (JSONB has no partial
 * update in Postgres via Kysely's typed API here, so read-modify-write is the straightforward
 * option for a 7-element array).
 */
export async function setDayCompleted(
  db: Db,
  studentId: string,
  planId: string,
  dayNumber: number,
  completed: boolean,
): Promise<StudyPlan | null> {
  const existing = await studyPlansRepository.findById(db, studentId, planId)
  if (!existing) return null

  const days = (existing.days as unknown as Array<StudyPlanDay>).map((day) =>
    day.day_number === dayNumber ? { ...day, completed } : day,
  )

  const updated = await studyPlansRepository.update(db, studentId, planId, {
    days: JSON.stringify(days),
  })

  return {
    id: updated.id,
    student_id: updated.student_id,
    week_start: updated.week_start.toISOString().slice(0, 10),
    days,
    status: updated.status,
  }
}
