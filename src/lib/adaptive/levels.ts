import type { BloomLevel, DifficultyTier } from '../../db/enums'

// The question bank stores a three-tier difficulty (F114: Easy / Hard / Hardest). The adaptive
// layer needs four steps, so the fourth is derived from Bloom level and never stored:
//
//   Level 1 Easy    Easy tier, Remember or Understand          (direct, confidence building)
//   Level 2 Medium  Easy tier Apply, or Hard tier Remember / Understand
//   Level 3 Hard    Hard tier Apply, Analyse, Evaluate or Create
//   Level 4 Master  Hardest tier
//
// With the standard 20-question grid per concept this gives 6 / 5 / 6 / 3 questions.
export type AdaptiveLevel = 1 | 2 | 3 | 4

export const LEVEL_NAMES: Record<AdaptiveLevel, string> = {
  1: 'Easy',
  2: 'Medium',
  3: 'Hard',
  4: 'Master',
}

export function adaptiveLevel(
  bloom: BloomLevel,
  difficulty: DifficultyTier,
): AdaptiveLevel {
  if (difficulty === 'Hardest') return 4
  const low = bloom === 'Remember' || bloom === 'Understand'
  if (difficulty === 'Easy') return low ? 1 : 2
  return low ? 2 : 3
}

export function clampLevel(level: number): AdaptiveLevel {
  return Math.min(4, Math.max(1, Math.round(level))) as AdaptiveLevel
}
