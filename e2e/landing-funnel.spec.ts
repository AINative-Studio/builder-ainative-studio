/**
 * Landing & pre-builder funnel E2E (Claude Design handoff: "Landing & Signup").
 *
 * Drives the public front door like a human would — every path, every button:
 *   landing → Get started → Start (Create / Grow) → Build (Surprise / My idea)
 *   → Intake, plus the Sign in path and the Grow-my-company → auth branch.
 *
 * The landing is shown to logged-out visitors by default (no session), so these
 * run against a cold visit to the root. testids are stable contracts on the
 * funnel buttons.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

async function gotoLanding(page: Page) {
  await page.goto(`${BASE_URL}/?screen=landing`)
  // The Cody ticker + BUILDER wordmark are the landing's tell.
  await expect(page.getByText('BUILDER', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
}

test.describe('Landing funnel — happy path (create → build my idea)', () => {
  test('landing hero renders the designed headline and CTA', async ({ page }) => {
    await gotoLanding(page)
    await expect(page.getByText('The Company That Builds Itself')).toBeVisible()
    await expect(page.getByTestId('landing-get-started')).toBeVisible()
  })

  test('Get started → Start → Create → Build → Intake', async ({ page }) => {
    await gotoLanding(page)

    // Beat 0 "Get started" enters the funnel.
    await page.getByTestId('landing-get-started').click()

    // Start screen: "Let's get started." Create is the default selection.
    await expect(page.getByText("Let's get started.")).toBeVisible()
    await expect(page.getByTestId('start-create')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('start-continue').click()

    // Build screen: "Let's build something."
    await expect(page.getByText("Let's build something.")).toBeVisible()
    await page.getByTestId('build-own-idea').click()

    // Intake: the idea field. "Build my idea" leaves it blank.
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    await expect(textarea).toHaveValue('')
  })

  test('Surprise me pre-fills the idea field in Intake', async ({ page }) => {
    await gotoLanding(page)
    await page.getByTestId('landing-get-started').click()
    await page.getByTestId('start-continue').click() // create → build
    await page.getByTestId('build-surprise').click()

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    // Surprise seeds a non-empty starter idea.
    await expect(textarea).not.toHaveValue('')
  })
})

test.describe('Landing funnel — alternate paths', () => {
  test('Grow my company routes to auth (login)', async ({ page }) => {
    await gotoLanding(page)
    await page.getByTestId('landing-get-started').click()
    await page.getByTestId('start-grow').click()
    await expect(page.getByTestId('start-grow')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('start-continue').click()
    // Auth surface appears (email field is the stable signal across auth layouts).
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Sign in from the landing nav goes straight to auth', async ({ page }) => {
    await gotoLanding(page)
    await page.getByTestId('landing-signin').click()
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Back from Build returns to Start', async ({ page }) => {
    await gotoLanding(page)
    await page.getByTestId('landing-get-started').click()
    await page.getByTestId('start-continue').click() // → build
    await page.getByTestId('build-back').click()
    await expect(page.getByText("Let's get started.")).toBeVisible()
  })
})
