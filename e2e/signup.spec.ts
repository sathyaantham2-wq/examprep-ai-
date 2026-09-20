import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'

/**
 * A new student creates her own login with no email confirmation: she is signed in at once and
 * lands on profile setup.
 */
test('student sign-up needs no email confirmation and lands on profile setup', async ({ page }) => {
  const db = createDb()
  const email = `e2e-signup-${Date.now()}@example.com`
  try {
    await page.goto('/', { waitUntil: 'networkidle' })
    // Hydration margin, same reason as the other specs.
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Create an account' }).click()
    // There is no account-type choice any more: only students can sign up.
    await expect(page.locator('#account-type')).toHaveCount(0)
    await page.fill('#name', 'Signup Kid')
    await page.fill('#email', email)
    await page.fill('#password', 'correcthorsebatterystaple')
    await page.fill('#confirm-password', 'correcthorsebatterystaple')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Sign up' }).click()

    await page.waitForURL('**/profile-setup')
    await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible()
    await expect(page.getByLabel('Student name')).toHaveValue('Signup Kid')
  } finally {
    const user = await db.selectFrom('users').select('household_id').where('email', '=', email).executeTakeFirst()
    if (user) await db.deleteFrom('households').where('id', '=', user.household_id).execute()
    await db.destroy()
  }
})
