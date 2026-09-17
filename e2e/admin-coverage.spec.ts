import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import { conceptsRepository } from '../src/db/repositories'
import { createQuestion } from '../src/lib/questions'
import { createParentSession, promoteToAdmin } from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * F115: the coverage grid had computeCoverageGrid()/the API route covered by
 * coverage-grid.integration.test.ts already -- this is the missing piece, the screen itself
 * (there was none anywhere in the repo). One question in one cell out of 18 is enough to prove
 * the grid renders real counts, not a placeholder.
 */

let db: Db
let admin: TestSession
let subjectId: string
let conceptId: string
const questionIds: Array<string> = []

test.beforeAll(async () => {
  db = createDb()
  admin = await createParentSession('e2e-coverage-admin')
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
    code: `C7M-1.E2ECOV-${Date.now()}`,
    name: 'E2E coverage fixture concept',
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
    text: 'E2E coverage fixture question',
    answer: 'A',
    created_by: 'e2e-coverage-fixture',
    // Every question is approved immediately on creation, which is what the coverage grid
    // actually counts (it only sums status='approved' rows).
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

test('admin coverage grid screen shows a real per-concept count', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.fill('#email', admin.email)
  await page.fill('#password', admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(1500)

  await page.goto('/admin/coverage', { waitUntil: 'networkidle' })
  await expect(
    page.getByRole('heading', { name: 'Bloom × difficulty coverage' }),
  ).toBeVisible()

  // Two subjects exist for CBSE/Class 7 (Mathematics, Science) -- the screen only auto-selects
  // when there's exactly one, so it must be picked explicitly (same as happy-path.spec.ts).
  // computeCoverageGridForSubject does one sequential DB round trip per concept (60+ for the real
  // MATH-SEED subject), so this response is much slower than a typical fetch -- wait for it
  // explicitly rather than relying on the default 5s assertion timeout.
  const gridResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/questions/coverage-grid') && r.ok(),
    { timeout: 30_000 },
  )
  await page.selectOption('#subject', subjectId)
  await gridResponsePromise

  const row = page.getByText('E2E coverage fixture concept')
  await expect(row).toBeVisible()
  await row.click()
  await expect(page.getByText('1/1', { exact: true }).first()).toBeVisible()
})
