import type { Db } from '../../db/connection'
import type { BloomLevel } from '../../db/enums'
import { loadMasteryConfig, signalsForConcepts } from './service'
import { LEVEL_NAMES } from './levels'
import type { AdaptiveLevel } from './levels'
import {
  allocateQuestions,
  computeConceptWeights,
  guaranteeRetention,
} from './weights'

// The size of a recommended paper. Not values the product plan specifies, so they live here in
// one place: a first assessment is short and Easy, later practice is a little longer.
export const INITIAL_QUESTIONS = 10
export const PRACTICE_QUESTIONS = 12
const MAX_RECOMMENDED_CHAPTERS = 2

export interface PlanSection {
  name: string
  count: number
  marks_per_question: number
  bloom_allowed: Array<BloomLevel>
}

export interface PlanConcept {
  concept_id: string
  concept_name: string
  chapter_id: string
  chapter_name: string
  level: AdaptiveLevel
  level_name: string
  mastery_score: number | null
  mastery_level: string | null
  questions_planned: number
  reasons: Array<string>
}

export interface PaperPlan {
  subject_id: string
  subject_name: string
  is_initial_assessment: boolean
  chapters: Array<{ id: string; name: string; part: string; chapter_no: number; concept_count: number }>
  concepts: Array<PlanConcept>
  total_questions: number
  total_marks: number
  difficulty_range: { min: string; max: string }
  estimated_minutes: number
  question_types: Array<string>
  sections: Array<PlanSection>
  recommended_next: PlanConcept | null
}

/**
 * The paper recommended for a student and subject: which chapters, how many questions per
 * concept, at what difficulty, and how long it should take. Everything comes from the student's
 * own concept mastery; a student with no history gets a short Easy first assessment.
 *
 * Written (short and long answer) sections appear once the student's concepts have moved up. Their
 * marks are proposed by the AI grader and confirmed automatically when it is confident; otherwise
 * the paper waits for a parent (see auto-confirm.ts).
 */
export async function buildPaperPlan(
  db: Db,
  input: {
    studentId: string
    subjectId: string
    chapterIds?: Array<string>
    // Short and long answer sections for concepts that have moved up. On by default.
    includeWritten?: boolean
  },
): Promise<PaperPlan | null> {
  const subject = await db
    .selectFrom('subjects')
    .select(['id', 'name'])
    .where('id', '=', input.subjectId)
    .executeTakeFirst()
  if (!subject) return null

  // Only chapters that actually have approved questions can be offered.
  const rows = await db
    .selectFrom('chapters as ch')
    .innerJoin('concepts as c', 'c.chapter_id', 'ch.id')
    .select([
      'ch.id as chapter_id',
      'ch.name as chapter_name',
      'ch.part',
      'ch.chapter_no',
      'ch.order_index',
      'c.id as concept_id',
      'c.name as concept_name',
    ])
    .where('ch.subject_id', '=', input.subjectId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('questions as q')
          .select('q.id')
          .whereRef('q.concept_id', '=', 'c.id')
          .where('q.status', '=', 'approved'),
      ),
    )
    .orderBy('ch.order_index')
    .execute()
  if (rows.length === 0) return null

  const config = await loadMasteryConfig(db)
  const now = new Date()
  const signals = await signalsForConcepts(db, input.studentId, rows.map((r) => r.concept_id), now)
  const signalById = new Map(signals.map((s) => [s.conceptId, s]))
  const weightById = new Map(
    computeConceptWeights(signals, config, now).map((w) => [w.conceptId, w]),
  )

  const performanceCount = signals.filter((s) => s.masteryScore !== null).length
  const isInitial = performanceCount === 0

  const chapterMeta = new Map<
    string,
    { id: string; name: string; part: string; chapter_no: number; order: number; concepts: Array<string> }
  >()
  for (const r of rows) {
    const meta = chapterMeta.get(r.chapter_id) ?? {
      id: r.chapter_id,
      name: r.chapter_name,
      part: r.part,
      chapter_no: r.chapter_no,
      order: r.order_index,
      concepts: [],
    }
    meta.concepts.push(r.concept_id)
    chapterMeta.set(r.chapter_id, meta)
  }

  let chosen: Array<string>
  if (input.chapterIds && input.chapterIds.length > 0) {
    chosen = input.chapterIds.filter((id) => chapterMeta.has(id))
  } else if (isInitial) {
    chosen = [...chapterMeta.values()]
      .sort((a, b) => a.order - b.order)
      .slice(0, MAX_RECOMMENDED_CHAPTERS)
      .map((c) => c.id)
  } else {
    const mean = (ids: Array<string>) =>
      ids.reduce((sum, id) => sum + (weightById.get(id)?.weight ?? 0), 0) / ids.length
    chosen = [...chapterMeta.values()]
      .sort((a, b) => mean(b.concepts) - mean(a.concepts) || a.order - b.order)
      .slice(0, MAX_RECOMMENDED_CHAPTERS)
      .map((c) => c.id)
  }
  if (chosen.length === 0) return null

  const chosenConceptIds = rows.filter((r) => chosen.includes(r.chapter_id)).map((r) => r.concept_id)
  const chosenSignals = chosenConceptIds.map((id) => signalById.get(id)!)
  const levels = chosenSignals.map((s) => s.currentLevel)
  const maxLevel = Math.max(...levels) as AdaptiveLevel
  const avgLevel = levels.reduce((a, b) => a + b, 0) / levels.length

  const objective = isInitial ? INITIAL_QUESTIONS : PRACTICE_QUESTIONS
  const sections: Array<PlanSection> = [
    {
      name: 'Section A',
      count: objective,
      marks_per_question: 1,
      bloom_allowed: ['Remember', 'Understand', 'Apply'],
    },
  ]
  if (input.includeWritten !== false && !isInitial) {
    if (avgLevel >= 2.5) {
      sections.push({
        name: 'Section B',
        count: 2,
        marks_per_question: 2,
        bloom_allowed: ['Analyse', 'Evaluate'],
      })
    }
    if (maxLevel >= 4) {
      sections.push({
        name: sections.length === 1 ? 'Section B' : 'Section C',
        count: 1,
        marks_per_question: 3,
        bloom_allowed: ['Create'],
      })
    }
  }
  const totalQuestions = sections.reduce((a, s) => s.count + a, 0)
  const totalMarks = sections.reduce((a, s) => a + s.count * s.marks_per_question, 0)

  const chosenWeights = chosenConceptIds.map((id) => weightById.get(id)!)
  const chapterOfConcept = new Map(rows.map((r) => [r.concept_id, r.chapter_id]))
  const allocation = guaranteeRetention(
    allocateQuestions(chosenWeights, totalQuestions, (id) => chapterOfConcept.get(id) ?? id),
    chosenSignals,
    totalQuestions,
  )

  const concepts: Array<PlanConcept> = rows
    .filter((r) => chosen.includes(r.chapter_id))
    .map((r) => {
      const s = signalById.get(r.concept_id)!
      return {
        concept_id: r.concept_id,
        concept_name: r.concept_name,
        chapter_id: r.chapter_id,
        chapter_name: r.chapter_name,
        level: s.currentLevel,
        level_name: LEVEL_NAMES[s.currentLevel],
        mastery_score: s.masteryScore,
        mastery_level: s.masteryLevel,
        questions_planned: allocation.get(r.concept_id) ?? 0,
        reasons: weightById.get(r.concept_id)?.reasons ?? [],
      }
    })

  const perQuestionMinutes = (s: PlanSection) =>
    s.marks_per_question === 1 ? 1.5 : s.marks_per_question === 2 ? 4 : 8
  const minutes = Math.max(
    5,
    Math.ceil(sections.reduce((a, s) => a + s.count * perQuestionMinutes(s), 0) / 5) * 5,
  )

  const types = ['Multiple choice']
  if (sections.some((s) => s.marks_per_question === 2)) types.push('Short answer')
  if (sections.some((s) => s.marks_per_question === 3)) types.push('Long answer')

  const byNeed = [...concepts].sort(
    (a, b) => (weightById.get(b.concept_id)?.weight ?? 0) - (weightById.get(a.concept_id)?.weight ?? 0),
  )

  return {
    subject_id: subject.id,
    subject_name: subject.name,
    is_initial_assessment: isInitial,
    chapters: chosen.map((id) => {
      const m = chapterMeta.get(id)!
      return { id, name: m.name, part: m.part, chapter_no: m.chapter_no, concept_count: m.concepts.length }
    }),
    concepts,
    total_questions: totalQuestions,
    total_marks: totalMarks,
    difficulty_range: { min: LEVEL_NAMES[1], max: LEVEL_NAMES[maxLevel] },
    estimated_minutes: minutes,
    question_types: types,
    sections,
    recommended_next: byNeed[0] ?? null,
  }
}

/**
 * Finds or creates the stored blueprint for a plan. Papers point at a blueprint row, so an
 * automatic plan is saved once per distinct shape and reused; nothing is ever deleted.
 */
export async function ensureAdaptiveBlueprint(
  db: Db,
  input: { subjectId: string; plan: PaperPlan },
) {
  const subject = await db
    .selectFrom('subjects')
    .select(['board', 'class'])
    .where('id', '=', input.subjectId)
    .executeTakeFirstOrThrow()

  const shape = input.plan.sections.map((s) => `${s.count}x${s.marks_per_question}m`).join(' + ')
  const name = `Adaptive (auto) ${shape}`
  const existing = await db
    .selectFrom('blueprints')
    .selectAll()
    .where('subject_id', '=', input.subjectId)
    .where('name', '=', name)
    .executeTakeFirst()
  if (existing) return existing

  const bloomTargets: Record<BloomLevel, number> = {
    Remember: 0, Understand: 0, Apply: 0, Analyse: 0, Evaluate: 0, Create: 0,
  }
  return db
    .insertInto('blueprints')
    .values({
      subject_id: input.subjectId,
      board: subject.board,
      class: subject.class,
      name,
      total_marks: input.plan.total_marks,
      duration_min: input.plan.estimated_minutes,
      sections: JSON.stringify(input.plan.sections),
      bloom_targets: JSON.stringify(bloomTargets),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}
