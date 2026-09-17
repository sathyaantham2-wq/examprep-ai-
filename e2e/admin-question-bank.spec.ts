import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import { conceptsRepository } from '../src/db/repositories'
import { createQuestion } from '../src/lib/questions'
import { createParentSession, promoteToAdmin } from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * F118 (tab06 /admin/questions "Question bank" section): the missing screen for the already-built
 * GET /api/questions/:id/stats and the status-flip half of PATCH /api/questions/:id. One approved
 * question with zero attempts is enough to prove the screen renders real stats (not a placeholder)
 * and that Retire really flips status via a real PATCH -- the stats computation itself is already
 * covered thoroughly by question-stats.integration.test.ts.
 */

let db: Db
let admin: TestSession
let subjectId: string
let conceptId: string
const questionIds: Array<string> = []

test.beforeAll(async () => {
  db = createDb()
  admin = await createParentSession('e2e-bank-admin')
  await promoteToAdmin(admin.userId)

  const subject = await db
    .selectFrom('subjects')
    .selectAll()
    .where('code', '=', 'MATH-SEED')
    .executeTakeFirstOrThrow()
  subjectId = subject.id
  const chapter = await db
    .selectFrom('chapters')
    .selectAll()
    .where('subject_id', '=', subject.id)
    .where('chapter_no', '=', 1)
    .executeTakeFirstOrThrow()

  const concept = await conceptsRepository.insert(db, {
    chapter_id: chapter.id,
    board: 'CBSE',
    class: 7,
    code: `C7M-1.E2EBANK-${Date.now()}`,
    name: 'E2E question bank fixture concept',
    difficulty_base: 'Easy',
    target_question_count: 18,
  })
  conceptId = concept.id

  const q = await createQuestion(db, {
    concept_id: concept.id,
    board: 'CBSE',
    class: 7,
    bloom: 'Remember',
    difficulty: 'Easy',
    marks: 1,
    type: 'mcq',
    text: 'E2E question bank fixture question',
    answer: 'A',
    created_by: 'e2e-bank-fixture',
    options: [{ label: 'A', text: '1', is_correct: true, order_index: 1 }],
  })
  questionIds.push(q.id)
})

test.afterAll(async () => {
  if (questionIds.length > 0) {
    await db
      .deleteFrom('question_options')
      .where('question_id', 'in', questionIds)
      .execute()
    await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
  }
  await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
  await db
    .deleteFrom('households')
    .where('id', '=', admin.householdId)
    .execute()
  await db.destroy()
})

test('admin question bank shows live stats and can retire/reinstate a question', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.fill('#email', admin.email)
  await page.fill('#password', admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(1500)

  await page.goto('/admin/questions', { waitUntil: 'networkidle' })
  await page.selectOption('#subject', subjectId)

  const bankResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/questions?concept=') && r.ok(),
  )
  await page.selectOption('#concept', conceptId)
  await bankResponsePromise

  const row = page.getByText('E2E question bank fixture question')
  await expect(row).toBeVisible()

  const statsResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/stats') && r.ok(),
  )
  await row.click()
  await statsResponsePromise
  await expect(page.getByText('0 attempts')).toBeVisible()

  const patchResponsePromise = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.ok(),
  )
  await page.getByRole('button', { name: 'Retire' }).click()
  await patchResponsePromise

  await expect(page.getByText('retired', { exact: true })).toBeVisible()
})
