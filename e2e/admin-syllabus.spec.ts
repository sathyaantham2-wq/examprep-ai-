import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import { createParentSession, promoteToAdmin } from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * F083 (tab06 /admin/syllabus): the read-only syllabus browser. Uses the pre-existing MATH-SEED
 * seed fixtures (chapter 1 "Sample Chapter — Fractions (seed)", its IN/OUT scope items, and its
 * concept) rather than creating new ones -- this screen has nothing to write, so there's nothing
 * for a beforeAll to set up beyond an admin session.
 */

let db: Db
let admin: TestSession
let subjectId: string

test.beforeAll(async () => {
  db = createDb()
  admin = await createParentSession('e2e-syllabus-admin')
  await promoteToAdmin(admin.userId)

  const subject = await db
    .selectFrom('subjects')
    .selectAll()
    .where('code', '=', 'MATH-SEED')
    .executeTakeFirstOrThrow()
  subjectId = subject.id
})

test.afterAll(async () => {
  await db
    .deleteFrom('households')
    .where('id', '=', admin.householdId)
    .execute()
  await db.destroy()
})

test('admin syllabus screen browses chapters, concepts and IN/OUT scope', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.fill('#email', admin.email)
  await page.fill('#password', admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(1500)

  await page.goto('/admin/syllabus', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Syllabus' })).toBeVisible()

  // Two subjects exist for CBSE/Class 7 (Mathematics, Science), so it must be picked explicitly.
  const chaptersResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/syllabus/chapters') && r.ok(),
  )
  await page.selectOption('#subject', subjectId)
  await chaptersResponsePromise

  const chapterHeading = page.getByText(
    'I Ch 1: Sample Chapter — Fractions (seed)',
  )
  await expect(chapterHeading).toBeVisible()

  const scopeResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/scope') && r.ok(),
  )
  await chapterHeading.click()
  await scopeResponsePromise

  await expect(page.getByText('Adding unlike fractions (seed)')).toBeVisible()
  await expect(
    page.getByText('Add and subtract fractions with unlike denominators (seed)'),
  ).toBeVisible()
  await expect(
    page.getByText('Multiplication and division of fractions (seed)'),
  ).toBeVisible()
})
