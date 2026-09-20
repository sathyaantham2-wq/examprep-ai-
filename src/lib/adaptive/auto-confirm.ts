import { randomUUID } from 'node:crypto'
import type { Db } from '../../db/connection'
import { auditLogRepository, paperQuestionsRepository } from '../../db/repositories'
import { captureError, describeError } from '../error-log'
import { confirmEvaluation, createEvaluation } from '../evaluation'
import { isObjectiveType } from '../scoring'

export interface AutoConfirmOutcome {
  // Set when the marks were confirmed straight away (a paper of multiple-choice questions only).
  evaluationId: string | null
  // True when written answers were marked by the AI and now wait for the student to look them
  // over, question a mark, and accept (see answer-review.ts).
  reviewPending: boolean
}

const NOTHING: AutoConfirmOutcome = { evaluationId: null, reviewPending: false }

/**
 * Marks a submitted adaptive paper with no parent involved.
 *
 * Multiple-choice only: marks come from the answer key and are confirmed at once.
 * With written answers: the AI proposes marks (generously) and the paper is left for the student,
 * who may question up to five marks, remove a question she still disputes, and then accept.
 * If the AI cannot mark ANY written answer with confidence, nothing is proposed and the paper
 * waits for a parent the usual way, so the system never invents a mark it has no basis for.
 * Never throws.
 */
export async function autoConfirmAttempt(
  db: Db,
  attempt: { id: string; paper_id: string; student_id: string },
): Promise<AutoConfirmOutcome> {
  try {
    const paper = await db
      .selectFrom('papers')
      .select('weighting')
      .where('id', '=', attempt.paper_id)
      .executeTakeFirst()
    const weighting = paper?.weighting as { adaptive?: { enabled?: boolean } } | null
    if (!weighting?.adaptive?.enabled) return NOTHING

    const slots = await paperQuestionsRepository.listForPaperWithQuestions(db, attempt.paper_id)
    if (slots.length === 0) return NOTHING

    const existing = await db
      .selectFrom('evaluations')
      .select('id')
      .where('attempt_id', '=', attempt.id)
      .executeTakeFirst()
    if (existing) return NOTHING

    const { evaluation, items } = await createEvaluation(db, attempt.id)

    const written = new Set(slots.filter((s) => !isObjectiveType(s.type)).map((s) => s.id))
    if (written.size > 0) {
      const needsHuman = items.some((i) => written.has(i.paper_question_id) && i.ai_marks === null)
      return needsHuman ? NOTHING : { evaluationId: null, reviewPending: true }
    }

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
    return { evaluationId: evaluation.id, reviewPending: false }
  } catch (error) {
    const { message, stack } = describeError(error)
    await captureError({
      requestId: randomUUID(),
      source: 'server',
      route: 'attempt-submit:auto-confirm',
      message,
      stack,
    })
    return NOTHING
  }
}
