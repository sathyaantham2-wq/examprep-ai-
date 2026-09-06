import type { Db } from '../db/connection'
import type { BloomLevel, DifficultyTier } from '../db/enums'
import {
  blueprintsRepository,
  papersRepository,
  paperQuestionsRepository,
  conceptStatusRepository,
  questionsRepository,
  questionUsageRepository,
  chaptersRepository,
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

// Largest-remainder apportionment: floor each key's share, then hand out the leftover units to
// whichever keys had the biggest fractional part, so the counts always sum to `total`. Weights
// are normalised by their own sum rather than assumed to sum to 100, so this works equally for
// percentage weightings (F028's 40/40/20) and raw counts (F113's per-chapter concept counts).
export function allocateProportionally<TKey extends string>(
  total: number,
  weights: Record<TKey, number>,
): Record<TKey, number> {
  const keys = Object.keys(weights) as Array<TKey>
  const weightSum = keys.reduce((sum, k) => sum + weights[k], 0)

  if (weightSum <= 0) {
    // No signal to weight by (e.g. every chapter has zero concepts) -- split as evenly as
    // possible rather than divide by zero, so generation still proceeds instead of erroring.
    const evenWeights = Object.fromEntries(keys.map((k) => [k, 1])) as Record<
      TKey,
      number
    >
    return allocateProportionally(total, evenWeights)
  }

  const raw = keys.map((key) => ({
    key,
    value: (total * weights[key]) / weightSum,
  }))
  const floored = raw.map((r) => ({
    key: r.key,
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

  return Object.fromEntries(floored.map((r) => [r.key, r.count])) as Record<
    TKey,
    number
  >
}

export function allocateByWeighting(
  total: number,
  weighting: Weighting,
): Record<Bucket, number> {
  return allocateProportionally(total, weighting)
}

/**
 * F113: default per-chapter marks target is proportional to how many concepts that chapter
 * contributes to the selected scope; `override` (validated to sum to 100 by the route) replaces
 * that default entirely when the caller wants to weight chapters by hand instead.
 */
export function computeChapterMarksTargets(
  totalMarks: number,
  chapterConceptCounts: Record<string, number>,
  override?: Record<string, number>,
): Record<string, number> {
  return allocateProportionally(totalMarks, override ?? chapterConceptCounts)
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
  // F113: chapter_id -> percentage (must sum to 100, enforced by the route). Overrides the
  // concept-count-proportional default entirely when supplied.
  chapter_weighting_override?: Record<string, number>
  // How far back "recently served" looks when avoiding repeats — a lightweight version of F026.
  recentUsageWindowDays?: number
}

interface Shortfall {
  section: string
  bucket?: Bucket
  reason: string
}

/**
 * The paper generator (F027-F032, F113, F119). Draws questions per blueprint section, weighting
 * concept selection 40/40/20 across weak+priority / needs-practice / strong (F028) regardless of
 * the difficulty ceiling the student picked (F119), spreads marks across the selected chapters
 * proportionally to each chapter's concept count (F113), and reports rather than blocks when a
 * slot, the Bloom mix, or a chapter's proportional target can't be satisfied (F032/F029/F113).
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
    .select(['id', 'chapter_id'])
    .where('chapter_id', 'in', input.chapter_ids)
    .execute()
  const conceptIds = chapterConcepts.map((c) => c.id)
  const chapterByConceptId = new Map(
    chapterConcepts.map((c) => [c.id, c.chapter_id]),
  )

  // F113: every requested chapter gets an entry even with zero concepts, so it still shows up
  // (at a 0-mark target) rather than silently vanishing from the proportional split.
  const chapterConceptCounts: Record<string, number> = Object.fromEntries(
    input.chapter_ids.map((id) => [id, 0]),
  )
  for (const c of chapterConcepts) {
    chapterConceptCounts[c.chapter_id] =
      (chapterConceptCounts[c.chapter_id] ?? 0) + 1
  }
  const nominalTotalMarks = sections.reduce(
    (sum, s) => sum + s.marks_per_question * s.count,
    0,
  )
  const chapterMarksTargets = computeChapterMarksTargets(
    nominalTotalMarks,
    chapterConceptCounts,
    input.chapter_weighting_override,
  )
  const chapterMarksAssigned: Record<string, number> = Object.fromEntries(
    input.chapter_ids.map((id) => [id, 0]),
  )

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

        // F113: try chapters in order of largest remaining proportional deficit first, so marks
        // land on the chapter that most needs them; a chapter with a 0 target (e.g. no concepts)
        // is skipped entirely.
        const chaptersByDeficit = [...input.chapter_ids].sort(
          (a, b) =>
            chapterMarksTargets[b] -
            chapterMarksAssigned[b] -
            (chapterMarksTargets[a] - chapterMarksAssigned[a]),
        )

        let picked: { id: string; bloom: BloomLevel } | undefined
        let chosenChapterId: string | undefined

        for (const chapterId of chaptersByDeficit) {
          if ((chapterMarksTargets[chapterId] ?? 0) <= 0) continue
          const chapterPool = pool.filter(
            (id) => chapterByConceptId.get(id) === chapterId,
          )
          if (chapterPool.length === 0) continue

          const eligible = await questionsRepository.findEligibleForSlot(
            db,
            {
              conceptIds: chapterPool,
              bloomAllowed: section.bloom_allowed,
              difficultiesAllowed,
              marks: section.marks_per_question,
              excludeQuestionIds: [...excludeQuestionIds],
            },
            1,
          )
          if (eligible.at(0)) {
            picked = eligible.at(0)
            chosenChapterId = chapterId
            break
          }
        }

        // No chapter with a live deficit could supply this slot -- fall back to the whole pool
        // (old, chapter-agnostic behaviour) so the paper still fills, and say so rather than
        // silently drifting from the proportional target (F032's "report, never hide").
        if (!picked) {
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
          picked = eligible.at(0)
          chosenChapterId = picked
            ? chapterByConceptId.get(picked.id)
            : undefined
          if (picked) {
            shortfalls.push({
              section: section.name,
              bucket,
              reason: `Question drawn from chapter ${chosenChapterId ?? 'unknown'} instead of the chapter with the largest remaining proportional target -- no eligible question existed there for this slot`,
            })
          }
        }

        if (!picked) {
          shortfalls.push({
            section: section.name,
            bucket,
            reason: `No approved question available for bloom in [${section.bloom_allowed.join(', ')}], difficulty<=${input.difficulty_ceiling ?? 'Hardest'}, ${section.marks_per_question} mark(s)`,
          })
          continue
        }

        excludeQuestionIds.add(picked.id)
        if (chosenChapterId) {
          chapterMarksAssigned[chosenChapterId] =
            (chapterMarksAssigned[chosenChapterId] ?? 0) +
            section.marks_per_question
        }
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

  // F113: flag any chapter whose actual marks drift from its proportional target by more than a
  // mark (or 5% of the paper, whichever is larger) -- small rounding gaps are expected and fine.
  for (const chapterId of input.chapter_ids) {
    const target = chapterMarksTargets[chapterId] ?? 0
    const actual = chapterMarksAssigned[chapterId] ?? 0
    const tolerance = Math.max(1, nominalTotalMarks * 0.05)
    if (Math.abs(actual - target) > tolerance) {
      shortfalls.push({
        section: 'overall',
        reason: `Chapter ${chapterId} got ${actual} mark(s) vs a ${target} mark proportional target`,
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

  // F113: resolved for the paper header (part + chapter_no + name) -- read-only, so it's safe to
  // fetch outside the write transaction below.
  const chapters = await chaptersRepository.listByIds(db, input.chapter_ids)

  const result = await db.transaction().execute(async (trx) => {
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
        chapter_target: chapterMarksTargets,
        chapter_actual: chapterMarksAssigned,
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

  return { ...result, chapters }
}
