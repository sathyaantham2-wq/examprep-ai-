import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import { studentsRepository } from '../src/db/repositories'
import {
  createParentSession,
  createStudentSession,
  promoteToAdmin,
} from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * Admin student-activity screen (2026-10-03 request). A real student signs in and touches the
 * app, the browser sends its ping on its own, and the admin screen then shows her with time
 * credited. The server-side crediting rules are covered by student-activity.integration.test.ts;
 * this proves the browser half (the ping component) and the screen itself.
 */

let db: Db
let admin: TestSession
let student: TestSession
let studentId: string
let studentName: string

test.beforeAll(async () => {
  db = createDb()
  admin = await createParentSession('e2e-activity-admin')
  await promoteToAdmin(admin.userId)
  studentName = `E2E Activity Kid ${Date.now()}`
  const row = await studentsRepository.insert(db, {
    household_id: admin.householdId,
    name: studentName,
    class: 7,
    board: 'CBSE',
    target_exams: JSON.stringify([]),
    profile_completed_at: new Date(),
  })
  studentId = row.id
  student = await createStudentSession('e2e-activity-student', admin.householdId, studentId)
})

test.afterAll(async () => {
  await db.deleteFrom('student_activity_daily').where('student_id', '=', studentId).execute()
  await db.deleteFrom('households').where('id', '=', admin.householdId).execute()
  await db.destroy()
})

test('a student using the app is counted, and the admin sees her minutes', async ({
  browser,
}) => {
  const studentContext = await browser.newContext()
  const studentPage = await studentContext.newPage()
  await studentPage.goto('/', { waitUntil: 'networkidle' })
  await studentPage.waitForTimeout(2000)
  await studentPage.fill('#email', student.email)
  await studentPage.fill('#password', student.password)
  const pinged = studentPage.waitForResponse(
    (r) => r.url().includes('/api/activity/ping') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await studentPage.getByRole('button', { name: 'Sign in' }).click()
  // Touch the screen so she counts as present, then wait for the browser's own ping.
  await studentPage.waitForTimeout(1500)
  await studentPage.mouse.click(10, 10)
  const response = await pinged
  expect(response.status()).toBe(204)
  await studentContext.close()

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/', { waitUntil: 'networkidle' })
  await adminPage.waitForTimeout(2000)
  await adminPage.fill('#email', admin.email)
  await adminPage.fill('#password', admin.password)
  await adminPage.getByRole('button', { name: 'Sign in' }).click()
  await adminPage.waitForTimeout(1500)

  await adminPage.goto('/admin/activity', { waitUntil: 'networkidle' })
  await expect(adminPage.getByRole('heading', { name: 'Student activity' })).toBeVisible()
  const row = adminPage.getByRole('row').filter({ hasText: studentName })
  await expect(row).toBeVisible()
  await expect(row).toContainText('min')
  await adminContext.close()
})
