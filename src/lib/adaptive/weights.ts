import type { MasteryConfig } from './config'
import type { AdaptiveLevel } from './levels'
import type { MasteryLevelName, RetentionStatus } from './engine'

export interface ConceptSignal {
  conceptId: string
  // null when the student has never answered a question on this concept.
  masteryScore: number | null
  masteryLevel: MasteryLevelName | null
  currentLevel: AdaptiveLevel
  consecutiveWrong: number
  recentAccuracy: number | null
  lastAssessedAt: Date | null
  retention: RetentionStatus
}

export interface ConceptWeight {
  conceptId: string
  weight: number
  reasons: Array<string>
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How much of the next paper each concept should get. Weak concepts, concepts with recent
 * mistakes and concepts not seen for a while weigh more; Mastered concepts keep a small base
 * weight, and a bump when a retention check is due, so they never vanish from the paper.
 */
export function computeConceptWeights(
  signals: Array<ConceptSignal>,
  config: MasteryConfig,
  now: Date,
): Array<ConceptWeight> {
  const w = config.weightage
  return signals.map((s) => {
    const reasons: Array<string> = []
    let weight: number

    if (s.masteryScore === null) {
      weight = 0.6 + w.neverAssessedBoost
      reasons.push('not assessed yet')
    } else if (s.masteryLevel === 'Mastered') {
      weight = w.masteredBase
      reasons.push('mastered')
      if (s.retention === 'due') {
        weight += w.retentionDueBoost
        reasons.push('retention check due')
      }
    } else {
      weight = (100 - s.masteryScore) / 100
      reasons.push(`${s.masteryLevel ?? 'Beginner'} (${Math.round(s.masteryScore)})`)
      if (s.retention === 'lapsed') {
        weight += w.lapsedBoost
        reasons.push('slipped from Mastered')
      }
      if (s.consecutiveWrong > 0 || (s.recentAccuracy !== null && s.recentAccuracy < 50)) {
        weight += w.weakBoostRecentMistake
        reasons.push('recent mistakes')
      }
      if (
        s.lastAssessedAt &&
        now.getTime() - s.lastAssessedAt.getTime() > w.staleAfterDays * DAY_MS
      ) {
        weight += w.staleBoost
        reasons.push('not practised recently')
      }
    }
    return { conceptId: s.conceptId, weight: Math.max(weight, 0.01), reasons }
  })
}

/**
 * Largest-remainder split of `total` questions in proportion to each concept's weight. When
 * `groupOf` is given (a chapter id per concept) the questions are first shared out between the
 * groups by their total weight and only then between the concepts inside each group, so a chapter
 * with many equally weighted concepts can never crowd another chapter out. Ties go to whichever
 * comes first, which keeps the result the same every time it is worked out.
 */
export function allocateQuestions(
  weights: Array<ConceptWeight>,
  total: number,
  groupOf?: (conceptId: string) => string,
): Map<string, number> {
  if (groupOf) {
    const groups = new Map<string, Array<ConceptWeight>>()
    for (const w of weights) {
      const key = groupOf(w.conceptId)
      groups.set(key, [...(groups.get(key) ?? []), w])
    }
    const perGroup = allocateQuestions(
      [...groups.entries()].map(([key, members]) => ({
        conceptId: key,
        weight: members.reduce((sum, m) => sum + m.weight, 0),
        reasons: [],
      })),
      total,
    )
    const merged = new Map<string, number>()
    for (const [key, members] of groups) {
      for (const [id, count] of allocateQuestions(members, perGroup.get(key) ?? 0)) merged.set(id, count)
    }
    return merged
  }
  const result = new Map<string, number>()
  if (weights.length === 0 || total <= 0) return result
  const sum = weights.reduce((a, b) => a + b.weight, 0)
  const raw = weights.map((c) => ({ id: c.conceptId, exact: (c.weight / sum) * total }))
  let assigned = 0
  for (const r of raw) {
    const floor = Math.floor(r.exact)
    result.set(r.id, floor)
    assigned += floor
  }
  const byRemainder = [...raw].sort(
    (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)),
  )
  for (let i = 0; assigned < total; i++, assigned++) {
    const id = byRemainder[i % byRemainder.length].id
    result.set(id, (result.get(id) ?? 0) + 1)
  }
  return result
}

/**
 * Applies the "mastered concepts never disappear" rule to an allocation: a concept whose
 * retention is due or lapsed gets at least one question (when the paper is big enough), taken
 * from the concept that currently has the most.
 */
export function guaranteeRetention(
  allocation: Map<string, number>,
  signals: Array<ConceptSignal>,
  total: number,
): Map<string, number> {
  const out = new Map(allocation)
  const need = signals.filter(
    (s) => (s.retention === 'due' || s.retention === 'lapsed') && (out.get(s.conceptId) ?? 0) === 0,
  )
  for (const s of need) {
    if ([...out.values()].reduce((a, b) => a + b, 0) < total || total === 0) break
    let donor: string | undefined
    let most = 1
    for (const [id, count] of out) {
      if (count > most && !need.some((n) => n.conceptId === id)) {
        donor = id
        most = count
      }
    }
    if (!donor) break
    out.set(donor, (out.get(donor) ?? 0) - 1)
    out.set(s.conceptId, 1)
  }
  return out
}

export type Bucket = 'weak_priority' | 'needs_practice' | 'strong'

export function bucketForConcept(
  signal: Pick<ConceptSignal, 'masteryScore' | 'masteryLevel'>,
  config: MasteryConfig,
): Bucket {
  if (signal.masteryScore === null) return 'needs_practice'
  if (signal.masteryLevel === 'Mastered' || signal.masteryLevel === 'Advanced') return 'strong'
  if (signal.masteryScore < config.levels.proficient) return 'weak_priority'
  return 'needs_practice'
}

/**
 * Turns the concept weights into the 40/40/20 style bucket split the generator already uses, but
 * driven by this student's real mastery. The weak/priority share never falls below the floor
 * (F119) when the student has any weak concept.
 */
export function bucketWeighting(
  weights: Array<ConceptWeight>,
  signals: Array<ConceptSignal>,
  config: MasteryConfig,
): { weak_priority: number; needs_practice: number; strong: number } {
  const totals = { weak_priority: 0, needs_practice: 0, strong: 0 }
  const bySignal = new Map(signals.map((s) => [s.conceptId, s]))
  for (const w of weights) {
    const signal = bySignal.get(w.conceptId)
    if (!signal) continue
    totals[bucketForConcept(signal, config)] += w.weight
  }
  const sum = totals.weak_priority + totals.needs_practice + totals.strong
  if (sum === 0) return { weak_priority: 40, needs_practice: 40, strong: 20 }
  let result = {
    weak_priority: (totals.weak_priority / sum) * 100,
    needs_practice: (totals.needs_practice / sum) * 100,
    strong: (totals.strong / sum) * 100,
  }
  const floor = config.weakPriorityFloorPercent
  if (totals.weak_priority > 0 && result.weak_priority < floor) {
    const rest = result.needs_practice + result.strong
    const scale = rest > 0 ? (100 - floor) / rest : 0
    result = {
      weak_priority: floor,
      needs_practice: result.needs_practice * scale,
      strong: result.strong * scale,
    }
  }
  if (totals.strong > 0 && result.strong < config.weightage.retentionMinShare) {
    const take = config.weightage.retentionMinShare - result.strong
    const donor = result.needs_practice >= result.weak_priority - floor ? 'needs_practice' : 'weak_priority'
    if (result[donor] - take >= (donor === 'weak_priority' ? floor : 0)) {
      result[donor] -= take
      result.strong += take
    }
  }
  return {
    weak_priority: Math.round(result.weak_priority * 10) / 10,
    needs_practice: Math.round(result.needs_practice * 10) / 10,
    strong: Math.round(result.strong * 10) / 10,
  }
}
