import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The install popup on a shared link (2026-10-02 request). A test browser never offers a real
 * install, so the browser's own "this app can be installed" event is fired by hand; everything
 * after that -- the popup, the answer being remembered -- is the real code.
 */

async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string; platform: string }>
    }
    event.prompt = () => Promise.resolve()
    event.userChoice = Promise.resolve({
      outcome: 'dismissed',
      platform: 'web',
    })
    window.dispatchEvent(event)
  })
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' })
  // Hydration margin, same reason as the other specs.
  await page.waitForTimeout(2000)
}

test('a shared link offers the install as a popup, once', async ({ page }) => {
  await open(page, '/?source=share')
  await offerInstall(page)

  const dialog = page.getByRole('dialog', { name: 'Install PrepPlan' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Not now' }).click()
  await expect(dialog).toHaveCount(0)
  // Sign-in is still right there underneath.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  // She answered; the same link does not ask again.
  await open(page, '/?source=share')
  await offerInstall(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the ordinary sign-in page shows no popup, even when install is possible', async ({
  page,
}) => {
  await open(page, '/')
  await offerInstall(page)
  // The quiet banner is the offer here, not a popup.
  await expect(page.getByText('Install PrepPlan')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('nothing is offered when the browser cannot install the app', async ({
  page,
}) => {
  await open(page, '/?source=share')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Install PrepPlan')).toHaveCount(0)
})
