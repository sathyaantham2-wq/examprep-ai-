import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/connection'
import { notificationsRepository } from '../db/repositories'
import { env } from './env'
import type { WeeklySummary } from './weekly-summary'

// F080: "Paper ready, evaluation complete, weekly summary." 'daily_nudge' is F082's own event,
// added on top of F080's three -- same delivery plumbing, a fourth `template` value so every
// `notifications` row still says exactly which of the four this was.
export type EmailTemplate =
  | 'paper_ready'
  | 'evaluation_complete'
  | 'weekly_summary'
  | 'daily_nudge'
  | 'guardian_invite'

export function isEmailConfigured(): boolean {
  return Boolean(env.MAKE_EMAIL_WEBHOOK_URL)
}

/**
 * F080: "unsubscribe honoured." HMAC-signed rather than a stored, revocable token -- there's
 * nothing to look up or expire, and the signature can't be forged without BETTER_AUTH_SECRET, so
 * a link is valid indefinitely for exactly the one user it names. Deliberately reuses the app's
 * one existing secret rather than introducing a second one to manage.
 */
export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(userId).digest('hex')
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(userId))
  const actual = Buffer.from(token)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function unsubscribeFooter(userId: string): { html: string; text: string } {
  const url = `${env.BETTER_AUTH_URL}/api/notifications/unsubscribe?user_id=${userId}&token=${unsubscribeToken(userId)}`
  return {
    html: `<p style="color:#888;font-size:12px">Don't want these emails? <a href="${url}">Unsubscribe</a>.</p>`,
    text: `\n\nDon't want these emails? Unsubscribe: ${url}`,
  }
}

export interface EmailContent {
  subject: string
  html: string
  text: string
}

export function buildGuardianInviteEmail(input: {
  guardianName: string
  guardianRole: string
  appUrl: string
}): EmailContent {
  return {
    subject: `${input.guardianName} wants to follow your progress`,
    html: `<p>${input.guardianName} (${input.guardianRole}) has asked to see your progress on ExamPrep AI.</p><p><a href="${input.appUrl}">Sign in</a> and choose Approve or Decline. Nothing is shared until you approve, and you can stop sharing at any time.</p>`,
    text: `${input.guardianName} (${input.guardianRole}) has asked to see your progress on ExamPrep AI.\nSign in to approve or decline: ${input.appUrl}\nNothing is shared until you approve.`,
  }
}

export function buildPaperReadyEmail(input: {
  studentName: string
  paperTitle: string
  paperUrl: string
}): EmailContent {
  return {
    subject: `${input.studentName}'s paper is ready`,
    html: `<p>A new paper, "${input.paperTitle}", is ready for ${input.studentName}.</p><p><a href="${input.paperUrl}">Open it</a>.</p>`,
    text: `A new paper, "${input.paperTitle}", is ready for ${input.studentName}.\n${input.paperUrl}`,
  }
}

export function buildEvaluationCompleteEmail(input: {
  studentName: string
  paperTitle: string
  // Provisional -- computed from the auto-scored/AI-proposed marks_awarded before a human
  // confirms anything (CLAUDE.md: "AI never finalises a mark"), so this is deliberately worded
  // as pending review, never as a final result.
  provisionalPercentage: number
  reviewUrl: string
}): EmailContent {
  return {
    subject: `${input.studentName}'s attempt is ready for review`,
    html: `<p>${input.studentName}'s attempt on "${input.paperTitle}" has been scored (provisionally ${input.provisionalPercentage}%) and is ready for your review. <a href="${input.reviewUrl}">Review it</a>.</p>`,
    text: `${input.studentName}'s attempt on "${input.paperTitle}" has been scored (provisionally ${input.provisionalPercentage}%) and is ready for your review.\n${input.reviewUrl}`,
  }
}

export function buildDailyNudgeEmail(input: {
  studentName: string
  actionText: string
  nudgeUrl: string
}): EmailContent {
  return {
    subject: `Today's action for ${input.studentName}`,
    html: `<p>${input.actionText}</p><p><a href="${input.nudgeUrl}">Open the app</a> when it's done.</p>`,
    text: `${input.actionText}\n${input.nudgeUrl}`,
  }
}

export function buildWeeklySummaryEmail(input: {
  studentName: string
  summary: WeeklySummary
  summaryUrl: string
}): EmailContent {
  const { summary } = input
  const lines: Array<string> = []
  if (summary.best_subject) {
    lines.push(
      `Best subject: ${summary.best_subject.subject_name} (${summary.best_subject.avg_percentage}%)`,
    )
  }
  if (summary.most_improved_concept) {
    lines.push(`Most improved: ${summary.most_improved_concept.concept_name}`)
  }
  if (summary.urgent_concept) {
    lines.push(`Needs attention: ${summary.urgent_concept.concept_name}`)
  }
  if (summary.task_completion) {
    lines.push(
      `Study plan: ${summary.task_completion.tasks_completed}/${summary.task_completion.tasks_total} days done`,
    )
  }
  const bullets = lines.length > 0 ? lines : ['No activity recorded this week.']

  return {
    subject: `${input.studentName}'s weekly summary (${summary.week_start} – ${summary.week_end})`,
    html: `<p>Weekly summary for ${input.studentName}:</p><ul>${bullets.map((l) => `<li>${l}</li>`).join('')}</ul><p><a href="${input.summaryUrl}">See the full summary</a>.</p>`,
    text: `Weekly summary for ${input.studentName}:\n${bullets.map((l) => `- ${l}`).join('\n')}\n${input.summaryUrl}`,
  }
}

/**
 * F080: sends one transactional email via the Make.com webhook (Custom Webhook -> Gmail "Send an
 * email", see docs/decisions -- this app has no direct SMTP/email-provider account of its own).
 * Every call writes exactly one `notifications` row recording what happened:
 *   - 'skipped': the user unsubscribed, or MAKE_EMAIL_WEBHOOK_URL isn't configured (documented
 *     fallback, same "degrade rather than guess" shape as every AI feature's missing-API-key path)
 *   - 'sent': Make accepted the webhook (a 2xx here confirms intake, not final delivery -- Make
 *     responds before its Gmail step runs; this is the same guarantee any fire-and-forget webhook
 *     integration gives)
 *   - 'failed': the webhook call itself errored or returned non-2xx
 * Never throws -- a notification failure must never break the paper-generation/evaluation flow
 * that triggered it, same principle as logAiJob/logProductEvent.
 */
export async function sendTransactionalEmail(
  db: Db,
  input: { userId: string; template: EmailTemplate; content: EmailContent },
): Promise<void> {
  try {
    const user = await db
      .selectFrom('users')
      .select(['email', 'email_notifications_enabled'])
      .where('id', '=', input.userId)
      .executeTakeFirst()
    if (!user) return

    if (!user.email_notifications_enabled) {
      await notificationsRepository.insert(db, {
        user_id: input.userId,
        channel: 'email',
        template: input.template,
        payload: JSON.stringify({ reason: 'unsubscribed' }),
        status: 'skipped',
      })
      return
    }

    if (!env.MAKE_EMAIL_WEBHOOK_URL) {
      await notificationsRepository.insert(db, {
        user_id: input.userId,
        channel: 'email',
        template: input.template,
        payload: JSON.stringify({ reason: 'email not configured' }),
        status: 'skipped',
      })
      return
    }

    const footer = unsubscribeFooter(input.userId)
    const response = await fetch(env.MAKE_EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: user.email,
        subject: input.content.subject,
        html: input.content.html + footer.html,
        text: input.content.text + footer.text,
      }),
    })

    await notificationsRepository.insert(db, {
      user_id: input.userId,
      channel: 'email',
      template: input.template,
      payload: JSON.stringify({ subject: input.content.subject }),
      ...(response.ok
        ? { status: 'sent' as const, sent_at: new Date() }
        : { status: 'failed' as const }),
    })
  } catch (err) {
    console.error('sendTransactionalEmail: failed', err)
    await notificationsRepository
      .insert(db, {
        user_id: input.userId,
        channel: 'email',
        template: input.template,
        payload: JSON.stringify({
          reason: err instanceof Error ? err.message : String(err),
        }),
        status: 'failed',
      })
      .catch(() => {})
  }
}

/**
 * F080's own user story is "As a parent I want email alerts" -- every one of the three named
 * events (paper ready, evaluation complete, weekly summary) is parent-facing, never sent to the
 * student. Fans out to every parent-role user in the household (normally one, per F008's "a
 * sign-up starts one household with one parent", but a future multi-parent household should have
 * both notified independently rather than picking one arbitrarily).
 */
export async function notifyHouseholdParents(
  db: Db,
  input: { householdId: string; template: EmailTemplate; content: EmailContent },
): Promise<void> {
  const parents = await db
    .selectFrom('users')
    .select('id')
    .where('household_id', '=', input.householdId)
    .where('role', '=', 'parent')
    .execute()
  for (const parent of parents) {
    await sendTransactionalEmail(db, {
      userId: parent.id,
      template: input.template,
      content: input.content,
    })
  }
}
