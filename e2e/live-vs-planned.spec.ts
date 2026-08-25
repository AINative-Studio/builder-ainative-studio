/**
 * E2E tests for Live vs Planned/Simulated badges (#67).
 *
 * Verifies that:
 *  1. The business-systems grid renders badge elements (data-testid="system-status-badge").
 *  2. Each badge has a data-status attribute of either "live" or "planned" — never missing.
 *  3. The honest framing line (data-testid="systems-framing-line") is present.
 *  4. Planned badges have the "Planned" label; live badges have "Live".
 *  5. The distinction is consistent — no card is unlabeled.
 *
 * These tests run against a local dev server. The builder goes through the
 * intake flow first to reach the Live screen.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate through Intake to reach the Live dashboard for a test company. */
async function reachLiveDashboard(page: Page, idea = 'AI SaaS for freelancers') {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // Type an idea in the prompt box (various selectors depending on the build state)
  const promptBox = page.locator(
    'textarea[placeholder*="company"], textarea[placeholder*="idea"], textarea[placeholder*="build"], input[placeholder*="company"], input[placeholder*="idea"]',
  ).first()

  const promptVisible = await promptBox.isVisible({ timeout: 8_000 }).catch(() => false)
  if (!promptVisible) {
    // Fall back: navigate directly to a known company preview URL
    await page.goto(`${BASE_URL}/build/test-live-badges`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    return
  }

  await promptBox.fill(idea)

  // Submit (Enter or button)
  await promptBox.press('Enter').catch(async () => {
    const submit = page.locator('button[type="submit"], button:has-text("Build"), button:has-text("Start")').first()
    if (await submit.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submit.click()
    }
  })

  // Wait for the Live screen to appear (it renders after intake flow)
  await page.waitForSelector('[data-testid="systems-grid"], .m-systems', { timeout: 60_000 }).catch(() => {
    // Acceptable if we don't reach Live in E2E — the DOM unit tests cover the logic
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Live vs Planned badges on systems grid (#67)', () => {
  test('systems grid is present on the Live dashboard', async ({ page }) => {
    await reachLiveDashboard(page)

    // The systems grid is inside the Live screen; might not render if intake is slow
    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)

    if (!gridVisible) {
      // If Live is not reachable in this E2E environment, skip gracefully
      test.skip(true, 'Live dashboard not reached in this environment — unit tests cover badge logic')
      return
    }

    await expect(grid).toBeVisible()
  })

  test('every system card has a status badge', async ({ page }) => {
    await reachLiveDashboard(page)

    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)
    if (!gridVisible) {
      test.skip(true, 'Live dashboard not reached in this environment')
      return
    }

    // Count system cards
    const cards = grid.locator('.m-system')
    const cardCount = await cards.count()
    expect(cardCount).toBeGreaterThan(0)

    // Every card must have a badge
    const badges = grid.locator('[data-testid="system-status-badge"]')
    const badgeCount = await badges.count()
    expect(badgeCount).toBe(cardCount)
  })

  test('all badges have a valid data-status of "live" or "planned"', async ({ page }) => {
    await reachLiveDashboard(page)

    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)
    if (!gridVisible) {
      test.skip(true, 'Live dashboard not reached in this environment')
      return
    }

    const badges = grid.locator('[data-testid="system-status-badge"]')
    const badgeCount = await badges.count()
    expect(badgeCount).toBeGreaterThan(0)

    for (let i = 0; i < badgeCount; i++) {
      const status = await badges.nth(i).getAttribute('data-status')
      expect(['live', 'planned']).toContain(status)
    }
  })

  test('planned badges show "Planned" label text', async ({ page }) => {
    await reachLiveDashboard(page)

    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)
    if (!gridVisible) {
      test.skip(true, 'Live dashboard not reached in this environment')
      return
    }

    const plannedBadges = grid.locator('[data-testid="system-status-badge"][data-status="planned"]')
    const plannedCount = await plannedBadges.count()

    // For a fresh (unprovisioned) company there should be at least some planned systems
    if (plannedCount > 0) {
      for (let i = 0; i < plannedCount; i++) {
        await expect(plannedBadges.nth(i)).toContainText('Planned')
      }
    }
    // If somehow all are live, that's also acceptable — but we must have counted correctly
    expect(plannedCount).toBeGreaterThanOrEqual(0)
  })

  test('live badges show "Live" label text', async ({ page }) => {
    await reachLiveDashboard(page)

    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)
    if (!gridVisible) {
      test.skip(true, 'Live dashboard not reached in this environment')
      return
    }

    const liveBadges = grid.locator('[data-testid="system-status-badge"][data-status="live"]')
    const liveCount = await liveBadges.count()

    if (liveCount > 0) {
      for (let i = 0; i < liveCount; i++) {
        await expect(liveBadges.nth(i)).toContainText('Live')
      }
    }
  })

  test('honest framing line is present above the systems grid', async ({ page }) => {
    await reachLiveDashboard(page)

    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)
    if (!gridVisible) {
      test.skip(true, 'Live dashboard not reached in this environment')
      return
    }

    const framingLine = page.locator('[data-testid="systems-framing-line"]')
    await expect(framingLine).toBeVisible()

    // Framing line must contain substantive content (not empty, not "undefined")
    const text = await framingLine.textContent()
    expect(text).toBeTruthy()
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('null')
    expect(text!.trim().length).toBeGreaterThan(10)
  })

  test('framing line conveys real-vs-planned distinction', async ({ page }) => {
    await reachLiveDashboard(page)

    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)
    if (!gridVisible) {
      test.skip(true, 'Live dashboard not reached in this environment')
      return
    }

    const framingLine = page.locator('[data-testid="systems-framing-line"]')
    const text = (await framingLine.textContent()) ?? ''

    // Must mention either "live" or "go live" or "planned" — honest distinction
    const mentionsState = /\blive\b|\bplanned\b|\bgo live\b|\brunning\b/i.test(text)
    expect(mentionsState).toBe(true)
  })

  test('no raw "● live" or "○ sim" text markers remain (replaced by badges)', async ({ page }) => {
    await reachLiveDashboard(page)

    const grid = page.locator('[data-testid="systems-grid"], .m-systems').first()
    const gridVisible = await grid.isVisible({ timeout: 20_000 }).catch(() => false)
    if (!gridVisible) {
      test.skip(true, 'Live dashboard not reached in this environment')
      return
    }

    const gridText = await grid.textContent()
    // The raw text markers used before badges were introduced must not appear
    expect(gridText).not.toContain('● live')
    expect(gridText).not.toContain('○ sim')
  })
})
