import type { Db } from '../db/connection'
import {
  evaluationItemsRepository,
  patternHitsRepository,
  conceptStatusRepository,
} from '../db/repositories'

interface ErrorInventoryRow {
  position: number
  section: string
  concept_name: string
  marks_max: number
  marks_awarded: number
  marks_lost: number
  error_type: string | null
  knowledge_known: boolean | null
  feedback: string
  patterns: Array<{ code: string; name: string }>
}

export interface UnmasteredPrerequisite {
  concept_id: string
  concept_name: string
  status: string | null
}

export interface RankedAction {
  concept_id: string
  concept_name: string
  status: string
  last_ratio: number | null
  action: string
  // F018: "weak concept surfaces its unmastered prerequisites in the diagnosis." Empty when the
  // concept has no prerequisites configured, or when every configured prerequisite is already
  // mastered (Strong/Maintenance) -- the same MASTERED_STATUSES definition
  // src/lib/student-dashboard.ts already uses.
  unmastered_prerequisites: Array<UnmasteredPrerequisite>
}

const MASTERED_STATUSES = new Set(['Strong', 'Maintenance'])

const PRIORITY_ORDER: Record<string, number> = {
  Priority: 0,
  Weak: 1,
  'Needs Practice': 2,
  Maintenance: 3,
  Strong: 4,
}

/**
 * F059/F018/F082: "worst-first from the student's whole tracker" -- tracker-wide (concept_status),
 * not scoped to any one paper or evaluation, which is why this takes a bare studentId rather than
 * an evaluationId. Originally inlined in buildDiagnosisReport (F059); pulled out so F082's daily
 * nudge can reuse the exact same ranking and action-text logic instead of a second, drifting copy.
 */
export async function getRankedActions(
  db: Db,
  studentId: string,
  limit = 3,
): Promise<Array<RankedAction>> {
  const statuses = await conceptStatusRepository.list(db, studentId)
  const candidates = statuses
    .filter((s) => s.status === 'Priority' || s.status === 'Weak')
    .sort((a, b) => (PRIORITY_ORDER[a.status] ?? 9) - (PRIORITY_ORDER[b.status] ?? 9))

  const ranked: Array<RankedAction> = []
  for (const status of candidates.slice(0, limit)) {
    const concept = await db
      .selectFrom('concepts')
      .select(['name', 'prerequisite_concept_ids'])
      .where('id', '=', status.concept_id)
      .executeTakeFirstOrThrow()

    const prerequisiteIds = concept.prerequisite_concept_ids
    const unmasteredPrerequisites: Array<UnmasteredPrerequisite> = []
    for (const prereqId of prerequisiteIds) {
      const prereqConcept = await db
        .selectFrom('concepts')
        .select(['name'])
        .where('id', '=', prereqId)
        .executeTakeFirst()
      if (!prereqConcept) continue // a dangling id (the concept was never real / was replaced)

      const prereqStatus = await conceptStatusRepository.findOne(db, studentId, prereqId)
      if (prereqStatus && MASTERED_STATUSES.has(prereqStatus.status)) continue

      unmasteredPrerequisites.push({
        concept_id: prereqId,
        concept_name: prereqConcept.name,
        status: prereqStatus?.status ?? null, // null == never attempted, not just "not mastered"
      })
    }

    const prereqNote =
      unmasteredPrerequisites.length > 0
        ? ` This also depends on ${unmasteredPrerequisites.map((p) => p.concept_name).join(', ')}, which isn't solid yet — that may be worth reviewing first.`
        : ''

    ranked.push({
      concept_id: status.concept_id,
      concept_name: concept.name,
      status: status.status,
      last_ratio: status.last_ratio !== null ? Number(status.last_ratio) : null,
      action: `Practice ${concept.name} — currently ${status.status}${status.last_ratio !== null ? `, last scored ${Math.round(Number(status.last_ratio) * 100)}%` : ''}.${prereqNote}`,
      unmastered_prerequisites: unmasteredPrerequisites,
    })
  }
  return ranked
}

interface ConceptPerformanceRow {
  concept_id: string
  concept_name: string
  marks_awarded: number
  marks_max: number
  percentage: number
}

/**
 * F059: the paper diagnosis report. Rule-based end to end — this is AI-10's own documented
 * fallback ("rule-based template report"), used as the primary implementation here rather than
 * a stopgap, since the numbers must come from data either way (AI-10's guardrail: "the model
 * never computes scores").
 */
export async function buildDiagnosisReport(db: Db, evaluationId: string) {
  const evaluation = await db
    .selectFrom('evaluations')
    .selectAll()
    .where('id', '=', evaluationId)
    .executeTakeFirstOrThrow()

  const attempt = await db
    .selectFrom('attempts')
    .selectAll()
    .where('id', '=', evaluation.attempt_id)
    .executeTakeFirstOrThrow()

  const paper = await db
    .selectFrom('papers')
    .select(['title'])
    .where('id', '=', attempt.paper_id)
    .executeTakeFirstOrThrow()
  const student = await db
    .selectFrom('students')
    .select(['name', 'class', 'board'])
    .where('id', '=', attempt.student_id)
    .executeTakeFirstOrThrow()

  const items = await evaluationItemsRepository.listForEvaluation(
    db,
    evaluationId,
  )

  const inventory: Array<ErrorInventoryRow> = []
  for (const item of items) {
    const marksLost = Number(item.marks_max) - Number(item.marks_awarded)
    if (marksLost <= 0) continue // full marks — not part of the error inventory

    const slot = await db
      .selectFrom('paper_questions')
      .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
      .innerJoin('concepts', 'concepts.id', 'questions.concept_id')
      .select([
        'paper_questions.position',
        'paper_questions.section',
        'concepts.name as concept_name',
      ])
      .where('paper_questions.id', '=', item.paper_question_id)
      .executeTakeFirstOrThrow()

    const hits = await patternHitsRepository.listForItem(db, item.id)
    const patterns = await Promise.all(
      hits.map(async (hit) => {
        const pattern = await db
          .selectFrom('patterns')
          .select(['code', 'name'])
          .where('id', '=', hit.pattern_id)
          .executeTakeFirstOrThrow()
        return pattern
      }),
    )

    inventory.push({
      position: slot.position,
      section: slot.section,
      concept_name: slot.concept_name,
      marks_max: Number(item.marks_max),
      marks_awarded: Number(item.marks_awarded),
      marks_lost: marksLost,
      error_type: item.error_type,
      knowledge_known: item.knowledge_known,
      feedback: item.feedback ?? '',
      patterns,
    })
  }
  inventory.sort((a, b) => a.position - b.position)

  // F073's "concept-wise performance" -- every item, not just the ones that lost marks (the
  // error inventory above only tracks those), aggregated per concept.
  const performanceByConcept = new Map<
    string,
    { concept_name: string; marks_awarded: number; marks_max: number }
  >()
  for (const item of items) {
    const slot = await db
      .selectFrom('paper_questions')
      .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
      .innerJoin('concepts', 'concepts.id', 'questions.concept_id')
      .select(['concepts.id as concept_id', 'concepts.name as concept_name'])
      .where('paper_questions.id', '=', item.paper_question_id)
      .executeTakeFirstOrThrow()

    const existing = performanceByConcept.get(slot.concept_id) ?? {
      concept_name: slot.concept_name,
      marks_awarded: 0,
      marks_max: 0,
    }
    existing.marks_awarded += Number(item.marks_awarded)
    existing.marks_max += Number(item.marks_max)
    performanceByConcept.set(slot.concept_id, existing)
  }
  const conceptPerformance: Array<ConceptPerformanceRow> = [
    ...performanceByConcept.entries(),
  ]
    .map(([conceptId, v]) => ({
      concept_id: conceptId,
      concept_name: v.concept_name,
      marks_awarded: v.marks_awarded,
      marks_max: v.marks_max,
      percentage:
        v.marks_max > 0
          ? Math.round((v.marks_awarded / v.marks_max) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => a.concept_name.localeCompare(b.concept_name))

  const patternCounts = new Map<string, { name: string; count: number }>()
  for (const row of inventory) {
    for (const pattern of row.patterns) {
      const existing = patternCounts.get(pattern.code) ?? {
        name: pattern.name,
        count: 0,
      }
      existing.count += 1
      patternCounts.set(pattern.code, existing)
    }
  }

  // Actions: worst-first from the student's whole tracker, not just this paper — a Delivery Gap
  // report is about what to do next, and that's tracker-wide, not paper-scoped.
  const ranked = await getRankedActions(db, attempt.student_id)

  const parentAction = ranked[0]
    ? `This week, have your child redo a short practice set on ${ranked[0].concept_name}.`
    : 'No priority or weak concepts flagged right now — keep up the current pace.'

  // F058: one rating per habit that was actually recorded for this evaluation via
  // PATCH /api/evaluations/:id/habits -- empty until a reviewer rates any, same as
  // error_inventory/pattern_hits above depend on a human having reviewed the paper.
  const habitRows = await db
    .selectFrom('habit_observations')
    .innerJoin('habits', 'habits.id', 'habit_observations.habit_id')
    .select([
      'habits.code as habit_code',
      'habits.name as habit_name',
      'habit_observations.rating',
    ])
    .where('habit_observations.evaluation_id', '=', evaluationId)
    .execute()

  return {
    meta: {
      paper_title: paper.title,
      student_name: student.name,
      student_class: student.class,
      student_board: student.board,
    },
    score: {
      actual: Number(evaluation.actual_score),
      total: Number(evaluation.total_marks),
      percentage: Number(evaluation.percentage),
      grade: evaluation.grade,
    },
    knowledge_score: Number(evaluation.knowledge_score),
    delivery_gap: Number(evaluation.delivery_gap),
    error_inventory: inventory,
    concept_performance: conceptPerformance,
    pattern_hits: [...patternCounts.entries()].map(([code, v]) => ({
      pattern_code: code,
      pattern_name: v.name,
      count: v.count,
    })),
    habit_status: habitRows.map((row) => ({
      habit_code: row.habit_code,
      habit_name: row.habit_name,
      rating: row.rating,
    })),
    actions: {
      ranked,
      parent_action: parentAction,
    },
  }
}
