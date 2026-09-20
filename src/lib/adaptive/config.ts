import { z } from 'zod'

// Every number the adaptive layer uses lives here so Admin can change it without a deploy
// (stored as one JSON row in mastery_settings, merged over these defaults). All scores and
// percentages are on a 0-100 scale.
const percent = z.number().min(0).max(100)

export const masteryConfigSchema = z.object({
  // Mastery Score = accuracy*w + recent*w + difficulty*w + consistency*w. Must sum to 1.
  weights: z
    .object({
      accuracy: z.number().min(0).max(1),
      recent: z.number().min(0).max(1),
      difficulty: z.number().min(0).max(1),
      consistency: z.number().min(0).max(1),
    })
    .refine(
      (w) => Math.abs(w.accuracy + w.recent + w.difficulty + w.consistency - 1) < 0.001,
      { message: 'weights must sum to 1' },
    ),
  // Lower bound of each level; Beginner starts at 0.
  levels: z
    .object({
      developing: percent,
      proficient: percent,
      advanced: percent,
      mastered: percent,
    })
    .refine(
      (l) => l.developing < l.proficient && l.proficient < l.advanced && l.advanced < l.mastered,
      { message: 'level thresholds must increase' },
    ),
  // "Mastered" needs ALL of these, so one lucky test can never create it.
  evidence: z.object({
    minQuestions: z.number().int().min(1),
    minAccuracy: percent,
    recentWindow: z.number().int().min(1),
    minRecentAccuracy: percent,
    minHardOrMasterCorrect: z.number().int().min(0),
    minAssessments: z.number().int().min(1),
  }),
  // Rolling window used to decide whether to step the difficulty up or down.
  difficulty: z.object({
    windowSize: z.number().int().min(1),
    minAnswersToChange: z.number().int().min(1),
    increaseAt: percent,
    decreaseBelow: percent,
    // A level counts as demonstrated after this many attempts at >= this success rate.
    demonstrateMinAttempts: z.number().int().min(1),
    demonstrateMinRate: percent,
    // Highest score allowed while only levels up to N have been demonstrated.
    scoreCapByHighestLevel: z.object({ '0': percent, '1': percent, '2': percent }),
  }),
  // A single answer moves the score only a little; repeated mistakes move it more.
  adjustment: z.object({
    maxDropPerAnswer: percent,
    maxDropPerAnswerRepeated: percent,
    maxRisePerAnswer: percent,
    // Below this many answers the score is pulled towards 50 (not enough evidence yet).
    fullConfidenceAt: z.number().int().min(1),
  }),
  recency: z.object({ window: z.number().int().min(1) }),
  // Credit (0-1) an answer needs to count as "correct" / to count as "wrong".
  correctCredit: z.number().min(0).max(1),
  // How many questions each concept gets in the next paper.
  weightage: z.object({
    masteredBase: z.number().min(0),
    weakBoostRecentMistake: z.number().min(0),
    staleAfterDays: z.number().int().min(1),
    staleBoost: z.number().min(0),
    neverAssessedBoost: z.number().min(0),
    retentionDueBoost: z.number().min(0),
    lapsedBoost: z.number().min(0),
    // Share of the paper reserved for revision of mastered concepts that are due (at least 1).
    retentionMinShare: percent,
  }),
  // Days until a mastered concept is asked again; each successful retention moves one step on.
  retention: z.object({ intervalsDays: z.array(z.number().int().min(1)).min(1) }),
  // The weak/priority share never drops below this (F119).
  weakPriorityFloorPercent: percent,
})

export type MasteryConfig = z.infer<typeof masteryConfigSchema>

export const DEFAULT_MASTERY_CONFIG: MasteryConfig = {
  weights: { accuracy: 0.6, recent: 0.2, difficulty: 0.1, consistency: 0.1 },
  levels: { developing: 40, proficient: 60, advanced: 75, mastered: 90 },
  evidence: {
    minQuestions: 10,
    minAccuracy: 90,
    recentWindow: 5,
    minRecentAccuracy: 80,
    minHardOrMasterCorrect: 2,
    minAssessments: 2,
  },
  difficulty: {
    windowSize: 5,
    minAnswersToChange: 3,
    increaseAt: 80,
    decreaseBelow: 50,
    demonstrateMinAttempts: 2,
    demonstrateMinRate: 70,
    scoreCapByHighestLevel: { '0': 39, '1': 74, '2': 89 },
  },
  adjustment: {
    maxDropPerAnswer: 6,
    maxDropPerAnswerRepeated: 10,
    maxRisePerAnswer: 8,
    fullConfidenceAt: 10,
  },
  recency: { window: 10 },
  correctCredit: 0.75,
  weightage: {
    masteredBase: 0.05,
    weakBoostRecentMistake: 0.25,
    staleAfterDays: 14,
    staleBoost: 0.15,
    neverAssessedBoost: 0.2,
    retentionDueBoost: 0.4,
    lapsedBoost: 0.3,
    retentionMinShare: 10,
  },
  retention: { intervalsDays: [7, 21, 60] },
  weakPriorityFloorPercent: 40,
}

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep-merges a stored (possibly partial or older) config over the defaults and validates it. */
export function resolveMasteryConfig(stored: unknown): MasteryConfig {
  const merge = (base: Json, over: Json): Json => {
    const out: Json = { ...base }
    for (const [key, value] of Object.entries(over)) {
      out[key] =
        isObject(value) && isObject(base[key]) ? merge(base[key], value) : value
    }
    return out
  }
  const merged = isObject(stored)
    ? merge(DEFAULT_MASTERY_CONFIG, stored)
    : DEFAULT_MASTERY_CONFIG
  const parsed = masteryConfigSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_MASTERY_CONFIG
}
