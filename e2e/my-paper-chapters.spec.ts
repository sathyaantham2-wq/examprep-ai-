import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import { studentsRepository } from '../src/db/repositories'
import { createParentSession, createStudentSession } from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * The chapter picker on /my-paper (2026-10-03 request): the parts (Part I, Part II ...) start
 * closed and she opens the one she wants. Uses the seeded multi-chapter Class 7 Maths subject so
 * the picker is shown at all (it hides itself when a subject has a single chapter).
 */

let db: Db
let parent: TestSession
let student: TestSession
let studentId: string

test.beforeAll(async () => {
  db = createDb()
  parent = await createParentSession('e2e-parts-parent')
  const row = await studentsRepository.insert(db, {
    household_id: parent.householdId,
    name: 'Parts Kid',
    class: 7,
    board: 'CBSE',
    target_exams: JSON.stringify([]),
  })
  studentId = row.id
  student = await createStudentSession('e2e-parts-student', parent.householdId, studentId)
})

test.afterAll(async () => {
  await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
  await db.destroy()
})

test('chapter parts start closed and open on tap', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.fill('#email', student.email)
  await page.fill('#password', student.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // A first sign-in finishes the profile first, as the adaptive-flow spec does.
  await page.waitForURL('**/profile-setup')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL('**/choose-board**')
  await page.getByRole('button', { name: 'Class 7' }).click()
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.waitForURL('**/my-paper**')

  const parts = page.locator('button[aria-expanded]').filter({ hasText: /Part / })
  await expect(parts.first()).toBeVisible({ timeout: 20_000 })
  const total = await parts.count()
  for (let i = 0; i < total; i++) {
    await expect(parts.nth(i)).toHaveAttribute('aria-expanded', 'false')
  }

  await parts.first().click()
  await expect(parts.first()).toHaveAttribute('aria-expanded', 'true')
  await parts.first().click()
  await expect(parts.first()).toHaveAttribute('aria-expanded', 'false')
})
