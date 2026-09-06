import type { Db } from '../db/connection'
import { conceptStatusRepository } from '../db/repositories'
import type { ConceptStatusValue } from '../db/enums'

interface PriorityConcept {
  concept_id: string
  concept_name: string
  status: ConceptStatusValue
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
      .limit(2)
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
    })
  }

  return { subjects: cards }
}
