import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import {
  createParentSession,
  promoteToAdmin,
  TEST_PASSWORD,
} from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * F083 (tab06 /admin/users): the screen itself. The API guards (self-deactivation, household
 * scoping, live session enforcement, audit log) are already covered thoroughly by
 * admin-users.integration.test.ts -- this proves the real browser round trip: the list renders
 * a second real account, and clicking Deactivate actually flips it via a real PATCH.
 */

let db: Db
let admin: TestSession
let secondParentEmail: string

test.beforeAll(async () => {
  db = createDb()
  admin = await createParentSession('e2e-users-admin')
  await promoteToAdmin(admin.userId)

  const { hashPassword } = await import('better-auth/crypto')
  secondParentEmail = `e2e-users-second-${Date.now()}@example.com`
  const user = await db
    .insertInto('users')
    .values({
      household_id: admin.householdId,
      email: secondParentEmail,
      name: 'E2E second parent',
      role: 'parent',
      email_verified: true,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  await db
    .insertInto('accounts')
    .values({
      issuer: 'local:credential',
      account_id: user.id,
      provider_id: 'credential',
      user_id: user.id,
      password: await hashPassword(TEST_PASSWORD),
    })
    .execute()
})

test.afterAll(async () => {
  await db
    .deleteFrom('households')
    .where('id', '=', admin.householdId)
    .execute()
  await db.destroy()
})

test('admin users screen lists accounts and can deactivate/reactivate one', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.fill('#email', admin.email)
  await page.fill('#password', admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(1500)

  await page.goto('/admin/users', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(page.getByText(secondParentEmail)).toBeVisible()

  const secondRow = page
    .locator('[data-slot="card"]')
    .filter({ hasText: 'E2E second parent' })
  const patchResponsePromise = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/households/users/') && r.ok(),
  )
  await secondRow.getByRole('button', { name: 'Deactivate' }).click()
  await patchResponsePromise

  await expect(page.getByText(`${secondParentEmail} — parent — deactivated`)).toBeVisible()
  await expect(secondRow.getByRole('button', { name: 'Reactivate' })).toBeVisible()
})
