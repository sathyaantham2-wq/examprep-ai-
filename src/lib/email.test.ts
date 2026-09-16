import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { householdsRepository } from '../db/repositories'
import {
  buildEvaluationCompleteEmail,
  buildPaperReadyEmail,
  buildWeeklySummaryEmail,
  isEmailConfigured,
  sendTransactionalEmail,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from './email'
import type { WeeklySummary } from './weekly-summary'

describe('unsubscribe token (F080)', () => {
  it('verifies a token generated for the same user', () => {
    const token = unsubscribeToken('user-123')
    expect(verifyUnsubscribeToken('user-123', token)).toBe(true)
  })

  it('rejects a token generated for a different user', () => {
    const token = unsubscribeToken('user-123')
    expect(verifyUnsubscribeToken('user-456', token)).toBe(false)
  })

  it('rejects a tampered token', () => {
    const token = unsubscribeToken('user-123')
    const tampered = token.slice(0, -1) + (token.at(-1) === '0' ? '1' : '0')
    expect(verifyUnsubscribeToken('user-123', tampered)).toBe(false)
  })

  it('is deterministic for the same user', () => {
    expect(unsubscribeToken('user-123')).toBe(unsubscribeToken('user-123'))
  })
})

describe('email template builders (F080)', () => {
  it('builds a paper-ready email naming the student and paper', () => {
    const content = buildPaperReadyEmail({
      studentName: 'Asha',
      paperTitle: 'Chapter 3 Practice',
      paperUrl: 'https://example.com/home',
    })
    expect(content.subject).toContain('Asha')
    expect(content.html).toContain('Chapter 3 Practice')
    expect(content.text).toContain('https://example.com/home')
  })

  it('builds an evaluation-complete email as provisional, never final', () => {
    const content = buildEvaluationCompleteEmail({
      studentName: 'Asha',
      paperTitle: 'Chapter 3 Practice',
      provisionalPercentage: 72,
      reviewUrl: 'https://example.com/home',
    })
    expect(content.html).toMatch(/provisionally/i)
    expect(content.text).toContain('72%')
  })

  it('builds a weekly-summary email covering every populated field, and a fallback when empty', () => {
    const fullSummary: WeeklySummary = {
      week_start: '2026-01-05',
      week_end: '2026-01-12',
      best_subject: {
        subject_id: 's1',
        subject_name: 'Maths',
        avg_percentage: 88,
        evaluations_count: 3,
      },
      most_improved_concept: { concept_id: 'c1', concept_name: 'Fractions', delta: 15 },
      urgent_concept: { concept_id: 'c2', concept_name: 'Integers' },
      seven_day_plan: [],
      cumulative_stats: {
        this_week: { evaluations_count: 3, avg_percentage: 80 },
        last_week: { evaluations_count: 2, avg_percentage: 70 },
      },
      task_completion: { tasks_completed: 5, tasks_total: 7 },
    }
    const content = buildWeeklySummaryEmail({
      studentName: 'Asha',
      summary: fullSummary,
      summaryUrl: 'https://example.com/home',
    })
    expect(content.html).toContain('Maths')
    expect(content.html).toContain('Fractions')
    expect(content.html).toContain('Integers')
    expect(content.text).toContain('5/7')

    const emptySummary: WeeklySummary = {
      ...fullSummary,
      best_subject: null,
      most_improved_concept: null,
      urgent_concept: null,
      task_completion: null,
    }
    const emptyContent = buildWeeklySummaryEmail({
      studentName: 'Asha',
      summary: emptySummary,
      summaryUrl: 'https://example.com/home',
    })
    expect(emptyContent.text).toMatch(/no activity/i)
  })
})

/**
 * F080: "unsubscribe honoured." Real DB, no real network call -- covers sendTransactionalEmail's
 * two "skipped" paths (unsubscribed, MAKE_EMAIL_WEBHOOK_URL not configured), both reachable
 * without a real webhook. See the note at the bottom of this describe block for why the
 * 'sent'/'failed' branches aren't covered here.
 */
describe('sendTransactionalEmail (F080)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let userId: string

  beforeAll(async () => {
    db = createDb()
    household = await householdsRepository.insert(db, {
      name: 'F080 Test Household',
      plan: 'free',
    })
    const user = await db
      .insertInto('users')
      .values({
        household_id: household.id,
        email: 'f080-parent@example.com',
        name: 'F080 Parent',
        role: 'parent',
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    userId = user.id
  })

  afterAll(async () => {
    await db.deleteFrom('notifications').where('user_id', '=', userId).execute()
    await db.deleteFrom('users').where('id', '=', userId).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.destroy()
  })

  it('skips and logs when the user has unsubscribed', async () => {
    await db
      .updateTable('users')
      .set({ email_notifications_enabled: false })
      .where('id', '=', userId)
      .execute()

    await sendTransactionalEmail(db, {
      userId,
      template: 'paper_ready',
      content: { subject: 's', html: 'h', text: 't' },
    })

    const row = await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', userId)
      .where('template', '=', 'paper_ready')
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('skipped')

    await db
      .updateTable('users')
      .set({ email_notifications_enabled: true })
      .where('id', '=', userId)
      .execute()
  })

  it('skips and logs when MAKE_EMAIL_WEBHOOK_URL is not configured (this dev/test environment)', async () => {
    expect(isEmailConfigured()).toBe(false)

    await sendTransactionalEmail(db, {
      userId,
      template: 'evaluation_complete',
      content: { subject: 's', html: 'h', text: 't' },
    })

    const row = await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', userId)
      .where('template', '=', 'evaluation_complete')
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('skipped')
  })

  // The 'sent'/'failed' branches (when MAKE_EMAIL_WEBHOOK_URL *is* configured) aren't covered
  // here: src/lib/env.ts parses process.env once at module load into a plain object, so there's
  // no way to flip that value for one test without either mocking the whole env module (which
  // would also break this file's real createDb() calls, since connection.ts imports the same
  // module) or a larger refactor to make the webhook URL an injectable parameter. The webhook
  // itself was verified working end-to-end with a real test send (Make execution log confirmed
  // SUCCESS) as part of setting it up -- this gap is in test coverage of the branch, not in
  // whether the integration actually works.
})
