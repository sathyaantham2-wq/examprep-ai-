import type { Db } from '../db/connection'

/**
 * Since 2026-10-02 every paper a student submits is marked at once (see
 * lib/adaptive/auto-confirm.ts), so a submitted attempt no longer sits waiting for a parent just
 * because it is a normal paper. A paper still waits for a parent when the AI cannot mark a
 * written answer with confidence. Tests of that parent-side flow call this right after submit to
 * put the attempt back in exactly that state: submitted, no evaluation.
 */
export async function undoAutoEvaluation(db: Db, attemptId: string): Promise<void> {
  const evaluations = await db
    .selectFrom('evaluations')
    .select('id')
    .where('attempt_id', '=', attemptId)
    .execute()
  const ids = evaluations.map((e) => e.id)
  if (ids.length === 0) return
  // Confirming an evaluation moves the attempt on to 'evaluated'; put it back as submitted.
  await db.updateTable('attempts').set({ status: 'submitted' }).where('id', '=', attemptId).execute()
  const items = await db
    .selectFrom('evaluation_items')
    .select('id')
    .where('evaluation_id', 'in', ids)
    .execute()
  const itemIds = items.map((i) => i.id)
  if (itemIds.length > 0) {
    await db.deleteFrom('student_points_ledger').where('evaluation_item_id', 'in', itemIds).execute()
  }
  await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', ids).execute()
  await db.deleteFrom('evaluations').where('id', 'in', ids).execute()
}
