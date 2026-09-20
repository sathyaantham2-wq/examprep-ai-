import { randomUUID } from 'node:crypto'
import type { Db } from '../../db/connection'
import { auditLogRepository, paperQuestionsRepository } from '../../db/repositories'
import { captureError, describeError } from '../error-log'
import { confirmEvaluation, createEvaluation } from '../evaluation'
import { isObjectiveType } from '../scoring'

/**
 * Marks a submitted adaptive paper and confirms the marks straight away, with no parent step.
 * (Product decision 2026-09-20: the system decides marks for adaptive practice, so a student with
 * nobody linked still builds a mastery record.)
 *
 * Multiple-choice marks come from the answer key. Written answers use the AI grader's proposal.
 * If the AI is unavailable, over its cap, or not confident about ANY written answer, nothing is
 * confirmed: the evaluation is left with its pre-filled marks for a parent to review the usual
 * way, so the system never invents a mark it has no basis for. Every automatic confirmation is
 * written to the audit log. Never throws.
 */
export async function autoConfirmAttempt(
  db: Db,
  attempt: { id: string; paper_id: string; student_id: string },
): Promise<string | null> {
  try {
    const paper = await db
      .selectFrom('papers')
      .select('weighting')
      .where('id', '=', attempt.paper_id)
      .executeTakeFirst()
    const weighting = paper?.weighting as { adaptive?: { enabled?: boolean } } | null
    if (!weighting?.adaptive?.enabled) return null

    const slots = await paperQuestionsRepository.listForPaperWithQuestions(db, attempt.paper_id)
    if (slots.length === 0) return null

    const existing = await db
      .selectFrom('evaluations')
      .select('id')
      .where('attempt_id', '=', attempt.id)
      .executeTakeFirst()
    if (existing) return null

    const { evaluation, items } = await createEvaluation(db, attempt.id)

    const written = new Set(slots.filter((s) => !isObjectiveType(s.type)).map((s) => s.id))
    const needsHuman = items.some((i) => written.has(i.paper_question_id) && i.ai_marks === null)
    if (needsHuman) return null

    const confirmed = await confirmEvaluation(db, evaluation.id)

    const student = await db
      .selectFrom('students')
      .select('household_id')
      .where('id', '=', attempt.student_id)
      .executeTakeFirstOrThrow()
    await auditLogRepository.insert(db, {
      household_id: student.household_id,
      actor_user_id: null,
      action: 'evaluation.auto_confirmed',
      entity: 'evaluations',
      entity_id: evaluation.id,
      before: null,
      after: JSON.stringify(confirmed),
    })
    return evaluation.id
  } catch (error) {
    const { message, stack } = describeError(error)
    await captureError({
      requestId: randomUUID(),
      source: 'server',
      route: 'attempt-submit:auto-confirm',
      message,
      stack,
    })
    return null
  }
}
