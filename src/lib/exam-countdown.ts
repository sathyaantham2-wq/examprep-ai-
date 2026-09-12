import type { Db } from '../db/connection'

interface TargetExam {
  name: string
  date: string
}

export interface ExamCountdown {
  exam_name: string
  exam_date: string
  days_remaining: number
}

export interface UntestedChapter {
  chapter_id: string
  chapter_name: string
}

export interface SyllabusCoverage {
  total_concepts: number
  strong_concepts: number
  strong_pct: number
  untested_chapters: Array<UntestedChapter>
}

export interface ExamCountdownReport {
  countdowns: Array<ExamCountdown>
  syllabus_coverage: SyllabusCoverage
}

const MASTERED_STATUSES = new Set(['Strong', 'Maintenance'])

/**
 * F078: "Countdown to each exam with % of syllabus concepts at Strong; highlights chapters
 * untested so far." "Syllabus" is scoped by (board, class) via subjects -- CLAUDE.md invariant 2
 * (board/class first-class everywhere) -- rather than only the subjects/chapters this student
 * has actually generated a paper for, since coverage is meant to describe the WHOLE curriculum,
 * not just what has been touched. One coverage summary applies to every exam (it isn't
 * per-subject data on target_exams), listed once alongside the per-exam countdowns.
 */
export async function buildExamCountdownReport(
  db: Db,
  studentId: string,
): Promise<ExamCountdownReport> {
  const student = await db
    .selectFrom('students')
    .select(['board', 'class', 'target_exams'])
    .where('id', '=', studentId)
    .executeTakeFirstOrThrow()

  const targetExams = student.target_exams as unknown as Array<TargetExam>
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  const countdowns: Array<ExamCountdown> = targetExams
    .map((exam) => {
      const examDate = new Date(`${exam.date}T00:00:00.000Z`)
      const daysRemaining = Math.round(
        (examDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      )
      return { exam_name: exam.name, exam_date: exam.date, days_remaining: daysRemaining }
    })
    .sort((a, b) => a.days_remaining - b.days_remaining)

  const subjects = await db
    .selectFrom('subjects')
    .select('id')
    .where('board', '=', student.board)
    .where('class', '=', student.class)
    .where('is_active', '=', true)
    .execute()
  const subjectIds = subjects.map((s) => s.id)

  const chapters =
    subjectIds.length > 0
      ? await db
          .selectFrom('chapters')
          .select(['id', 'name'])
          .where('subject_id', 'in', subjectIds)
          .execute()
      : []
  const chapterIds = chapters.map((c) => c.id)

  const concepts =
    chapterIds.length > 0
      ? await db
          .selectFrom('concepts')
          .select(['id', 'chapter_id'])
          .where('chapter_id', 'in', chapterIds)
          .execute()
      : []
  const conceptIds = concepts.map((c) => c.id)
  const totalConcepts = concepts.length

  const statuses =
    conceptIds.length > 0
      ? await db
          .selectFrom('concept_status')
          .select(['concept_id', 'status'])
          .where('student_id', '=', studentId)
          .where('concept_id', 'in', conceptIds)
          .execute()
      : []
  const statusByConcept = new Map(statuses.map((s) => [s.concept_id, s.status]))

  const strongConcepts = concepts.filter((c) =>
    MASTERED_STATUSES.has(statusByConcept.get(c.id) ?? ''),
  ).length

  const testedChapterIds = new Set(
    concepts
      .filter((c) => statusByConcept.has(c.id))
      .map((c) => c.chapter_id),
  )
  const untestedChapters: Array<UntestedChapter> = chapters
    .filter((c) => !testedChapterIds.has(c.id))
    .map((c) => ({ chapter_id: c.id, chapter_name: c.name }))

  return {
    countdowns,
    syllabus_coverage: {
      total_concepts: totalConcepts,
      strong_concepts: strongConcepts,
      strong_pct:
        totalConcepts > 0
          ? Math.round((strongConcepts / totalConcepts) * 1000) / 10
          : 0,
      untested_chapters: untestedChapters,
    },
  }
}
