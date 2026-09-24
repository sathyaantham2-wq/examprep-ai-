import type { Db } from '../../db/connection'
import { loadMasteryConfig, listPerformance } from './service'
import type { ConceptPerformance } from './service'
import { computeConceptWeights } from './weights'
import type { ConceptSignal } from './weights'
import { LEVEL_NAMES } from './levels'
import type { AdaptiveLevel } from './levels'

const RECOMMENDED_DIFFICULTY: Record<AdaptiveLevel, string> = {
  1: 'Easy',
  2: 'Easy + Medium',
  3: 'Medium + Hard',
  4: 'Hard + Master',
}

// 2026-09-24, user feedback with a screenshot: explainMastery()'s output (engine.ts, written "for
// the audit view") was the only thing ever wired into ConceptView.why, and it was the ONLY
// consumer of that function -- weights and coefficients ("Accuracy 66.7% x 0.6, recent 83.3% x
// 0.2, difficulty reached 0 x 0.1, consistency 5.7 x 0.1 = 57.2") shown directly to a student, who
// has no reason to know this scoring model exists. explainMastery() itself is untouched (a real
// audit view may still want it one day); this is what a student actually sees instead -- one
// plain sentence of where she stands, and the single nearest thing to work on, not every rule at
// once.
function friendlySummary(p: ConceptPerformance): Array<string> {
  if (p.questions_attempted === 0) {
    return ['Not attempted yet -- her first questions here will be Easy.']
  }
  const acc = Math.round(p.accuracy)
  const lines = [
    `${p.questions_attempted} question${p.questions_attempted === 1 ? '' : 's'} answered, ${acc}% correct overall.`,
  ]
  if (p.mastery_level === 'Mastered') {
    lines.push(
      'Mastered. It will come back for a quick revision from time to time to stay fresh.',
    )
  } else if (!p.evidence_met && p.evidence_blockers.length > 0) {
    // Only the nearest blocker -- explainMastery() joined every unmet rule at once, which read as
    // a checklist of demands rather than "the one thing to do next".
    lines.push(`To move up a level: ${p.evidence_blockers[0]}.`)
  } else {
    lines.push('A few more correct answers in a row will move this up a level.')
  }
  return lines
}

export interface ConceptView {
  concept_id: string
  concept_code: string
  concept_name: string
  mastery_score: number | null
  mastery_level: string
  current_difficulty: string
  current_level: AdaptiveLevel
  accuracy: number | null
  recent_accuracy: number | null
  questions_attempted: number
  assessment_count: number
  retention: string
  why: Array<string>
  video_url: string | null
  video_title: string | null
}

export interface ChapterView {
  chapter_id: string
  chapter_name: string
  part: string
  chapter_no: number
  average_mastery: number | null
  concepts: Array<ConceptView>
}

export interface SubjectView {
  subject_id: string
  subject_name: string
  has_content: boolean
  concepts_total: number
  concepts_assessed: number
  average_mastery: number | null
  mastered_count: number
  chapters: Array<ChapterView>
}

export interface AdaptiveOverview {
  student: { id: string; name: string; class: number; board: string }
  subjects: Array<SubjectView>
  overall: {
    concepts_total: number
    concepts_assessed: number
    average_mastery: number | null
    mastered_count: number
  }
  current_difficulty: string
  strong_concepts: Array<{
    concept_id: string
    concept_name: string
    subject_name: string
    mastery_score: number
    mastery_level: string
  }>
  needs_improvement: Array<{
    concept_id: string
    concept_name: string
    subject_name: string
    mastery_score: number
    mastery_level: string
    video_url: string | null
    video_title: string | null
  }>
  retention_due: Array<{
    concept_id: string
    concept_name: string
    subject_name: string
  }>
  recommended_next: {
    subject_id: string
    subject_name: string
    chapter_name: string
    concept_name: string
    level: string
    current_difficulty: string
    recommended_difficulty: string
    is_initial_assessment: boolean
    video_url: string | null
    video_title: string | null
  } | null
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

/**
 * Everything the student home needs: selected subjects with concept-level mastery grouped by
 * chapter, what is strong, what needs work, what is due for revision, and the single best next
 * thing to practise.
 */
export async function buildAdaptiveOverview(
  db: Db,
  studentId: string,
): Promise<AdaptiveOverview | null> {
  const student = await db
    .selectFrom('students')
    .select(['id', 'name', 'class', 'board'])
    .where('id', '=', studentId)
    .executeTakeFirst()
  if (!student) return null

  const selected = await db
    .selectFrom('student_subjects as ss')
    .innerJoin('subjects as s', 's.id', 'ss.subject_id')
    .select(['s.id', 's.name'])
    .where('ss.student_id', '=', studentId)
    .where('ss.is_active', '=', true)
    .orderBy('s.name')
    .execute()

  const config = await loadMasteryConfig(db)
  const now = new Date()
  const performance = await listPerformance(db, studentId, now)
  const perfByConcept = new Map(performance.map((p) => [p.concept_id, p]))

  const conceptRows = selected.length
    ? await db
        .selectFrom('concepts as c')
        .innerJoin('chapters as ch', 'ch.id', 'c.chapter_id')
        .select([
          'c.id as concept_id',
          'c.code as concept_code',
          'c.name as concept_name',
          'c.video_url',
          'c.video_title',
          'ch.id as chapter_id',
          'ch.name as chapter_name',
          'ch.part',
          'ch.chapter_no',
          'ch.order_index',
          'ch.subject_id',
        ])
        .where(
          'ch.subject_id',
          'in',
          selected.map((s) => s.id),
        )
        .orderBy('ch.order_index')
        .orderBy('c.code')
        .execute()
    : []

  const signals: Array<ConceptSignal> = conceptRows.map((r) => {
    const p = perfByConcept.get(r.concept_id)
    return p && p.questions_attempted > 0
      ? {
          conceptId: r.concept_id,
          masteryScore: p.mastery_score,
          masteryLevel: p.mastery_level,
          currentLevel: p.current_difficulty,
          consecutiveWrong: p.consecutive_wrong,
          recentAccuracy: p.recent_accuracy,
          lastAssessedAt: p.last_assessed_at,
          retention: p.retention,
        }
      : {
          conceptId: r.concept_id,
          masteryScore: null,
          masteryLevel: null,
          currentLevel: 1 as AdaptiveLevel,
          consecutiveWrong: 0,
          recentAccuracy: null,
          lastAssessedAt: null,
          retention: 'not_applicable' as const,
        }
  })
  const weights = new Map(
    computeConceptWeights(signals, config, now).map((w) => [w.conceptId, w]),
  )

  function view(
    r: (typeof conceptRows)[number],
    p: ConceptPerformance | undefined,
  ): ConceptView {
    if (!p || p.questions_attempted === 0) {
      return {
        concept_id: r.concept_id,
        concept_code: r.concept_code,
        concept_name: r.concept_name,
        mastery_score: null,
        mastery_level: 'Not started',
        current_difficulty: LEVEL_NAMES[1],
        current_level: 1,
        accuracy: null,
        recent_accuracy: null,
        questions_attempted: 0,
        assessment_count: 0,
        retention: 'not_applicable',
        why: friendlySummary({ questions_attempted: 0 } as ConceptPerformance),
        video_url: r.video_url,
        video_title: r.video_title,
      }
    }
    return {
      concept_id: r.concept_id,
      concept_code: r.concept_code,
      concept_name: r.concept_name,
      mastery_score: p.mastery_score,
      mastery_level: p.mastery_level,
      current_difficulty: LEVEL_NAMES[p.current_difficulty],
      current_level: p.current_difficulty,
      accuracy: p.accuracy,
      recent_accuracy: p.recent_accuracy,
      questions_attempted: p.questions_attempted,
      assessment_count: p.assessment_count,
      retention: p.retention,
      why: friendlySummary(p),
      video_url: r.video_url,
      video_title: r.video_title,
    }
  }

  const subjects: Array<SubjectView> = selected.map((subject) => {
    const rows = conceptRows.filter((r) => r.subject_id === subject.id)
    const chapters = new Map<string, ChapterView>()
    for (const r of rows) {
      const chapter = chapters.get(r.chapter_id) ?? {
        chapter_id: r.chapter_id,
        chapter_name: r.chapter_name,
        part: r.part,
        chapter_no: r.chapter_no,
        average_mastery: null,
        concepts: [],
      }
      chapter.concepts.push(view(r, perfByConcept.get(r.concept_id)))
      chapters.set(r.chapter_id, chapter)
    }
    for (const chapter of chapters.values()) {
      const scores = chapter.concepts
        .filter((c) => c.mastery_score !== null)
        .map((c) => c.mastery_score as number)
      chapter.average_mastery = scores.length
        ? round1(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null
    }
    const all = [...chapters.values()].flatMap((c) => c.concepts)
    const assessed = all.filter((c) => c.mastery_score !== null)
    return {
      subject_id: subject.id,
      subject_name: subject.name,
      has_content: rows.length > 0,
      concepts_total: all.length,
      concepts_assessed: assessed.length,
      average_mastery: assessed.length
        ? round1(
            assessed.reduce((a, b) => a + (b.mastery_score as number), 0) /
              assessed.length,
          )
        : null,
      mastered_count: all.filter((c) => c.mastery_level === 'Mastered').length,
      chapters: [...chapters.values()],
    }
  })

  const subjectName = new Map(selected.map((s) => [s.id, s.name]))
  const flat = conceptRows.map((r) => ({
    r,
    v: view(r, perfByConcept.get(r.concept_id)),
  }))
  const assessed = flat.filter((x) => x.v.mastery_score !== null)
  const brief = (x: (typeof flat)[number]) => ({
    concept_id: x.r.concept_id,
    concept_name: x.r.concept_name,
    subject_name: subjectName.get(x.r.subject_id) ?? '',
    mastery_score: x.v.mastery_score as number,
    mastery_level: x.v.mastery_level,
  })

  const strong = assessed
    .filter(
      (x) =>
        x.v.mastery_level === 'Mastered' || x.v.mastery_level === 'Advanced',
    )
    .sort(
      (a, b) => (b.v.mastery_score as number) - (a.v.mastery_score as number),
    )
    .slice(0, 5)
    .map(brief)
  const weak = assessed
    .filter((x) => (x.v.mastery_score as number) < config.levels.proficient)
    .sort(
      (a, b) => (a.v.mastery_score as number) - (b.v.mastery_score as number),
    )
    .slice(0, 5)
    .map((x) => ({
      ...brief(x),
      video_url: x.v.video_url,
      video_title: x.v.video_title,
    }))
  const due = flat
    .filter((x) => x.v.retention === 'due' || x.v.retention === 'lapsed')
    .map((x) => ({
      concept_id: x.r.concept_id,
      concept_name: x.r.concept_name,
      subject_name: subjectName.get(x.r.subject_id) ?? '',
    }))

  const levels = assessed.map((x) => x.v.current_level)
  const meanLevel = levels.length
    ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length)
    : 1
  const currentDifficulty =
    LEVEL_NAMES[Math.min(4, Math.max(1, meanLevel)) as AdaptiveLevel]

  const next = [...flat]
    .sort(
      (a, b) =>
        (weights.get(b.r.concept_id)?.weight ?? 0) -
        (weights.get(a.r.concept_id)?.weight ?? 0),
    )
    .at(0)

  return {
    student,
    subjects,
    overall: {
      concepts_total: flat.length,
      concepts_assessed: assessed.length,
      average_mastery: assessed.length
        ? round1(
            assessed.reduce((a, b) => a + (b.v.mastery_score as number), 0) /
              assessed.length,
          )
        : null,
      mastered_count: flat.filter((x) => x.v.mastery_level === 'Mastered')
        .length,
    },
    current_difficulty: currentDifficulty,
    strong_concepts: strong,
    needs_improvement: weak,
    retention_due: due,
    recommended_next: next
      ? {
          subject_id: next.r.subject_id,
          subject_name: subjectName.get(next.r.subject_id) ?? '',
          chapter_name: next.r.chapter_name,
          concept_name: next.r.concept_name,
          level: next.v.mastery_level,
          current_difficulty: next.v.current_difficulty,
          recommended_difficulty: RECOMMENDED_DIFFICULTY[next.v.current_level],
          is_initial_assessment: assessed.length === 0,
          video_url: next.v.video_url,
          video_title: next.v.video_title,
        }
      : null,
  }
}
