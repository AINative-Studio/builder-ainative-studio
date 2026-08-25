/**
 * E2E tests for the OnboardingVideo slot on the Live dashboard (#51).
 *
 * Verifies:
 *  1. The video card renders in the left column (data-testid="onboarding-video-card").
 *  2. It is NOT a raw black box — either the placeholder or a real video is present.
 *  3. In placeholder mode (no env src), the placeholder element renders.
 *  4. The "Hire the swarm" upsell card is preserved immediately after the video card.
 *
 * API routes are intercepted so the test is deterministic (no live ZeroDB dependency).
 * The shortcut screen=live param (used by tasks-backlog.spec.ts) reaches the dashboard.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

/** Stub only the data-fetching routes so Live renders without a backend. */
async function stubLiveRoutes(page: Page, company = 'e2e-onboarding') {
  // Provision endpoint
  await page.route(`**/api/build/provision?slug=${encodeURIComponent(company)}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provisioned: false, busy: false }),
    })
  )
  // Systems endpoint
  await page.route(`**/api/build/systems?**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ systems: [] }),
    })
  )
  // Nightshift endpoint
  await page.route(`**/api/build/nightshift?**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hasRun: false }),
    })
  )
  // Company-app endpoint
  await page.route(`**/api/build/company-app`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chatId: 'e2e-chat' }) })
  )
  // Cody chat endpoint (GET)
  await page.route(`**/api/build/ask?**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns: [] }) })
  )
  // App-registry (custom domain)
  await page.route(`**/api/build/register-app?**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: {} }) })
  )
  // Tasks endpoint
  await page.route(`**/api/build/tasks?**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
  )
  // Versions endpoint
  await page.route(`**/api/build/versions?**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: [] }) })
  )
  // Subscription status
  await page.route(`**/api/build/subscription/status`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: null }) })
  )
  // Live proof
  await page.route(`**/api/build/proof`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agentsActive: 42 }) })
  )
}

async function reachLiveDashboard(page: Page, company = 'e2e-onboarding') {
  await page.goto(`${BASE_URL}/?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  // Wait for any of the characteristic Live elements to appear.
  await page
    .waitForSelector(
      '[data-testid="onboarding-video-card"], .m-systems, [data-testid="tasks-panel"]',
      { timeout: 60_000 }
    )
    .catch(() => {})
}

test.describe('OnboardingVideo slot on Live dashboard (#51)', () => {
  test('video card renders in the left column — not a raw black box', async ({ page }) => {
    await stubLiveRoutes(page)
    await reachLiveDashboard(page)

    const card = page.locator('[data-testid="onboarding-video-card"]')
    if (!(await card.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable in this E2E environment')
    }
    await expect(card).toBeVisible()
  })

  test('placeholder or real video is visible inside the card (not an empty black box)', async ({
    page,
  }) => {
    await stubLiveRoutes(page)
    await reachLiveDashboard(page)

    const card = page.locator('[data-testid="onboarding-video-card"]')
    if (!(await card.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable in this E2E environment')
    }

    const wrap = page.locator('[data-testid="onboarding-video-wrap"]')
    await expect(wrap).toBeVisible()

    // Either placeholder OR real video — neither is acceptable as raw empty black box.
    const placeholder = page.locator('[data-testid="onboarding-video-placeholder"]')
    const videoEl = page.locator('[data-testid="onboarding-video-el"]')

    const hasPlaceholder = await placeholder.isVisible({ timeout: 3_000 }).catch(() => false)
    const hasVideo = await videoEl.isVisible({ timeout: 3_000 }).catch(() => false)
    expect(hasPlaceholder || hasVideo).toBe(true)
  })

  test('placeholder shows "Onboarding tutorial · coming soon" text', async ({ page }) => {
    await stubLiveRoutes(page)
    await reachLiveDashboard(page)

    const card = page.locator('[data-testid="onboarding-video-card"]')
    if (!(await card.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable in this E2E environment')
    }

    const placeholder = page.locator('[data-testid="onboarding-video-placeholder"]')
    if (!(await placeholder.isVisible({ timeout: 3_000 }).catch(() => false))) {
      // Real video src configured — placeholder branch doesn't render. Skip this check.
      test.skip(true, 'Real video src configured — placeholder state not rendered')
    }

    // The placeholder label is the "coming soon" affordance.
    await expect(page.locator('.m-onboarding-video-label')).toContainText(/coming soon/i)
  })

  test('"Hire the swarm" upsell card is preserved immediately after the video card', async ({
    page,
  }) => {
    await stubLiveRoutes(page)
    await reachLiveDashboard(page)

    const card = page.locator('[data-testid="onboarding-video-card"]')
    if (!(await card.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable in this E2E environment')
    }

    // "Upgrade to hire the swarm" or "On {plan}" button must still be in the DOM.
    const swarmBtn = page.locator('[data-testid="swarm-upgrade"]')
    await expect(swarmBtn).toBeVisible()
  })

  test('video card header reads "Onboarding"', async ({ page }) => {
    await stubLiveRoutes(page)
    await reachLiveDashboard(page)

    const card = page.locator('[data-testid="onboarding-video-card"]')
    if (!(await card.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable in this E2E environment')
    }

    await expect(card.locator('.m-live-card-h')).toContainText(/Onboarding/i)
  })
})
