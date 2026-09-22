import type { Db } from '../db/connection'
import type { DifficultyTier, QuestionType } from '../db/enums'
import { studentPointsLedgerRepository } from '../db/repositories'
import { isObjectiveType } from './scoring'

// F125 (first slice): no external spec sets these -- a documented default, same convention
// F118/F063 already use for an undocumented threshold. Harder questions pay more so the incentive
// points toward attempting Hard/Hardest rather than farming Easy ones. Coins mirror points 1:1
// for now (one reward currency, not two diverging ones) -- kept as its own column because the
// backlog entry names both "points" and "gold coins" as user-facing concepts, and a future pass
// may want them to diverge (e.g. coins spendable, points a pure leaderboard score) without a
// schema change.
export const POINTS_BY_DIFFICULTY: Record<DifficultyTier, number> = {
  Easy: 10,
  Hard: 20,
  Hardest: 30,
}

export function pointsForDifficulty(difficulty: DifficultyTier): number {
  return POINTS_BY_DIFFICULTY[difficulty]
}

export function coinsForPoints(points: number): number {
  return points
}

export interface GradedObjectiveItem {
  evaluationItemId: string
  conceptId: string
  questionType: QuestionType
  difficulty: DifficultyTier
  marksAwarded: number
  marksMax: number
}

/**
 * Called from confirmEvaluation(), inside the same transaction that just confirmed the marks --
 * points are a reward derived FROM a confirmed mark, so they only ever exist for marks that have
 * actually cleared CLAUDE.md's "AI never finalises a mark on a normal paper" gate (auto-confirmed
 * at submit for an all-MCQ adaptive paper per F119, or confirmed by a parent otherwise). Only
 * objective (answer-key-deterministic) items that were fully correct earn anything; a written
 * answer, a partially-correct item, or one worth zero max marks (a malformed row) earns nothing.
 * evaluation_item_id is UNIQUE on the table, so this is safe to call at most once per item --
 * confirmEvaluation's own confirmed_at guard already prevents a second call for the same
 * evaluation, this is defence in depth, not the primary safeguard.
 */
export async function recordPointsForConfirmedItems(
  db: Db,
  studentId: string,
  items: Array<GradedObjectiveItem>,
): Promise<void> {
  for (const item of items) {
    if (!isObjectiveType(item.questionType)) continue
    if (item.marksMax <= 0 || item.marksAwarded !== item.marksMax) continue

    const points = pointsForDifficulty(item.difficulty)
    await studentPointsLedgerRepository.insert(db, {
      student_id: studentId,
      evaluation_item_id: item.evaluationItemId,
      concept_id: item.conceptId,
      difficulty: item.difficulty,
      points,
      coins: coinsForPoints(points),
    })
  }
}
