import type { Db } from '../db/connection'
import type { BloomLevel, DifficultyTier } from '../db/enums'
import {
  blueprintsRepository,
  papersRepository,
  paperQuestionsRepository,
  conceptStatusRepository,
  questionsRepository,
  questionUsageRepository,
} from '../db/repositories'

const DIFFICULTY_ORDER: Array<DifficultyTier> = ['Easy', 'Hard', 'Hardest']

// F119: the ceiling limits which difficulty tiers are eligible, but does not touch which
// concepts get selected — the 40/40/20 weak/priority weighting below runs unconditionally.
export function difficultiesUpTo(
  ceiling: DifficultyTier,
): Array<DifficultyTier> {
  const idx = DIFFICULTY_ORDER.indexOf(ceiling)
  return DIFFICULTY_ORDER.slice(0, idx + 1)
}

export type Bucket = 'weak_priority' | 'needs_practice' | 'strong'

export interface Weighting {
  weak_priority: number
  needs_practice: number
  strong: number
}

export const DEFAULT_WEIGHTING: Weighting = {
  weak_priority: 40,
  needs_practice: 40,
  strong: 20,
}

// Largest-remainder apportionment: floor each bucket's share, then hand out the leftover slots
// to whichever buckets had the biggest fractional part, so the counts always sum to `total`.
export function allocateByWeighting(
  total: number,
  weighting: Weighting,
): Record<Bucket, number> {
  const buckets: Array<Bucket> = ['weak_priority', 'needs_practice', 'strong']
  const raw = buckets.map((bucket) => ({
    bucket,
    value: (total * weighting[bucket]) / 100,
  }))
  const floored = raw.map((r) => ({
    bucket: r.bucket,
    count: Math.floor(r.value),
    frac: r.value % 1,
  }))
  let remainder = total - floored.reduce((sum, r) => sum + r.count, 0)

  const byFracDesc = [...floored].sort((a, b) => b.frac - a.frac)
  for (const entry of byFracDesc) {
    if (remainder <= 0) break
    entry.count += 1
    remainder -= 1
  }

  return Object.fromEntries(floored.map((r) => [r.bucket, r.count])) as Record<
    Bucket,
    number
  >
}

interface BlueprintSection {
  name: string
  marks_per_question: number
  count: number
  bloom_allowed: Array<BloomLevel>
}

export interface GeneratePaperInput {
  student_id: string
  blueprint_id: string
  chapter_ids: Array<string>
  theme?: string
  difficulty_ceiling?: DifficultyTier
  weighting_override?: Weighting
  // How far back "recently served" looks when avoiding repeats — a lightweight version of F026.
  recentUsageWindowDays?: number
}

interface Shortfall {
  section: string
  bucket?: Bucket
  reason: string
}

/**
 * The paper generator (F027-F032, F119). Draws questions per blueprint section, weighting concept
 * selection 40/40/20 across weak+priority / needs-practice / strong (F028) regardless of the
 * difficulty ceiling the student picked (F119), and reports rather than blocks when a slot or the
 * Bloom mix can't be satisfied (F032/F029).
 *
 * F030 (internal choice / OR pairs) is not implemented — blueprint.choice_rules is stored but
 * ignored here; every section slot is a plain required question.
 */
export async function generatePaper(db: Db, input: GeneratePaperInput) {
  const blueprint = await blueprintsRepository.findById(db, input.blueprint_id)
  if (!blueprint) {
    throw new Error('Blueprint not found')
  }

  const sections = blueprint.sections as unknown as Array<BlueprintSection>
  const bloomTargets = blueprint.bloom_targets as unknown as Record<
    BloomLevel,
    number
  >
  const weighting = input.weighting_override ?? DEFAULT_WEIGHTING
  const difficultiesAllowed = difficultiesUpTo(
    input.difficulty_ceiling ?? 'Hardest',
  )
  const recentWindowDays = input.recentUsageWindowDays ?? 14

  const chapterConcepts = await db
    .selectFrom('concepts')
    .select(['id'])
    .where('chapter_id', 'in', input.chapter_ids)
    .execute()
  const conceptIds = chapterConcepts.map((c) => c.id)

  const statuses = await conceptStatusRepository.list(db, input.student_id)
  const statusByConcept = new Map(statuses.map((s) => [s.concept_id, s.status]))

  const buckets: Record<Bucket, Array<string>> = {
    weak_priority: [],
    needs_practice: [],
    strong: [],
  }
  for (const conceptId of conceptIds) {
    const status = statusByConcept.get(conceptId)
    if (status === 'Weak' || status === 'Priority')
      buckets.weak_priority.push(conceptId)
    else if (status === 'Strong' || status === 'Maintenance')
      buckets.strong.push(conceptId)
    else buckets.needs_practice.push(conceptId) // "Needs Practice" and never-attempted both land here
  }

  const excludeQuestionIds = new Set(
    await questionUsageRepository.listRecentQuestionIds(
      db,
      input.student_id,
      recentWindowDays,
    ),
  )

  const selected: Array<{
    section: string
    marks: number
    bucket: Bucket
    question: { id: string; bloom: BloomLevel }
  }> = []
  const shortfalls: Array<Shortfall> = []

  for (const section of sections) {
    const allocation = allocateByWeighting(section.count, weighting)

    for (const bucket of [
      'weak_priority',
      'needs_practice',
      'strong',
    ] as Array<Bucket>) {
      for (let i = 0; i < allocation[bucket]; i++) {
        // Fall back to the full chapter concept pool if this bucket happens to be empty (e.g. a
        // brand-new student with no Strong concepts yet) rather than silently under-filling.
        const pool = buckets[bucket].length > 0 ? buckets[bucket] : conceptIds

        const eligible = await questionsRepository.findEligibleForSlot(
          db,
          {
            conceptIds: pool,
            bloomAllowed: section.bloom_allowed,
            difficultiesAllowed,
            marks: section.marks_per_question,
            excludeQuestionIds: [...excludeQuestionIds],
          },
          1,
        )
        const picked = eligible.at(0)

        if (!picked) {
          shortfalls.push({
            section: section.name,
            bucket,
            reason: `No approved question available for bloom in [${section.bloom_allowed.join(', ')}], difficulty<=${input.difficulty_ceiling ?? 'Hardest'}, ${section.marks_per_question} mark(s)`,
          })
          continue
        }

        excludeQuestionIds.add(picked.id)
        selected.push({
          section: section.name,
          marks: section.marks_per_question,
          bucket,
          question: { id: picked.id, bloom: picked.bloom },
        })
      }
    }
  }

  // F029: report the actual Bloom mix and flag any target missed by more than 5 percentage
  // points, rather than blocking paper generation on it.
  const bloomCounts = new Map<BloomLevel, number>()
  for (const item of selected) {
    bloomCounts.set(
      item.question.bloom,
      (bloomCounts.get(item.question.bloom) ?? 0) + 1,
    )
  }
  const bloomActual: Partial<Record<BloomLevel, number>> = {}
  for (const [bloom, count] of bloomCounts) {
    bloomActual[bloom] =
      Math.round((count / Math.max(selected.length, 1)) * 1000) / 10
  }
  for (const [bloom, target] of Object.entries(bloomTargets) as Array<
    [BloomLevel, number]
  >) {
    const actual = bloomActual[bloom] ?? 0
    if (Math.abs(actual - target) > 5) {
      shortfalls.push({
        section: 'overall',
        reason: `Bloom mix off target: ${bloom} is ${actual}% vs a ${target}% target`,
      })
    }
  }

  const bucketActual: Record<Bucket, number> = {
    weak_priority: 0,
    needs_practice: 0,
    strong: 0,
  }
  for (const item of selected) bucketActual[item.bucket] += 1
  const bucketActualPct = Object.fromEntries(
    (Object.entries(bucketActual) as Array<[Bucket, number]>).map(
      ([bucket, count]) => [
        bucket,
        Math.round((count / Math.max(selected.length, 1)) * 1000) / 10,
      ],
    ),
  )

  const totalMarks = selected.reduce((sum, item) => sum + item.marks, 0)

  return db.transaction().execute(async (trx) => {
    const paper = await papersRepository.insert(trx, {
      student_id: input.student_id,
      blueprint_id: input.blueprint_id,
      subject_id: blueprint.subject_id,
      chapter_ids: input.chapter_ids,
      title: blueprint.name,
      total_marks: totalMarks,
      duration_min: blueprint.duration_min,
      theme: input.theme ?? 'Plain',
      weighting: JSON.stringify({
        target: weighting,
        actual: bucketActualPct,
        bloom_target: bloomTargets,
        bloom_actual: bloomActual,
      }),
      shortfalls:
        shortfalls.length > 0 ? JSON.stringify(shortfalls) : undefined,
    })

    const paperQuestions =
      selected.length > 0
        ? await paperQuestionsRepository.insertMany(
            trx,
            selected.map((item, index) => ({
              paper_id: paper.id,
              question_id: item.question.id,
              section: item.section,
              position: index + 1,
              marks: item.marks,
            })),
          )
        : []

    for (const item of selected) {
      await questionUsageRepository.insert(trx, {
        student_id: input.student_id,
        question_id: item.question.id,
        paper_id: paper.id,
      })
    }

    return { paper, paperQuestions, shortfalls }
  })
}
