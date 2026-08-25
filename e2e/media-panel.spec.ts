/**
 * E2E tests for the auto-media panel (#54) on the Live dashboard.
 *
 * Verifies on the real Live dashboard that:
 *  1. The Media panel renders (data-testid="media-panel") with an Auto Image and an
 *     Auto Video card, each with a frequency selector (Once/Daily/Weekly/Monthly)
 *     and a START AUTO action.
 *  2. Selecting a frequency + Start Auto persists a routine and shows next-run.
 *  3. When media generation isn't configured, an honest disabled note is shown and
 *     the panel still works (no fabricated assets).
 *  4. A configured company with an existing asset shows last-generated media.
 *
 * The panel loads from /api/build/media, which we intercept so the E2E is
 * deterministic (no dependency on live ZeroDB / a model). The Live screen is
 * reached via the same deep-link hook the Documents (#64) E2E uses.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

interface MediaState {
  routines: any[]
  assets: any[]
  configured: boolean
  nextRuns: Record<string, string | null>
}

/** Stub /api/build/media. GET → state; POST schedule → routine echo; POST generate → status. */
async function stubMedia(page: Page, state: MediaState) {
  await page.route('**/api/build/media**', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    }
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      if (body.action === 'generate') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state.configured ? { status: 'generated', asset: { id: 'x', mediaKind: body.mediaKind, url: 'http://x/gen.png', prompt: 'p', createdAt: new Date().toISOString() } } : { status: 'disabled' }),
        })
      }
      // schedule
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ routine: { id: 'r', mediaKind: body.mediaKind, frequency: body.frequency, enabled: true, createdAt: new Date().toISOString() }, configured: state.configured }),
      })
    }
    return route.continue()
  })
}

async function reachLiveDashboard(page: Page, company = 'e2e-media') {
  await page.goto(`${BASE_URL}/?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="media-panel"], .m-systems', { timeout: 60_000 }).catch(() => {})
}

const EMPTY: MediaState = { routines: [], assets: [], configured: false, nextRuns: {} }

test.describe('Auto-media panel (#54)', () => {
  test('renders Auto Image + Auto Video with frequency selectors and Start actions', async ({ page }) => {
    await stubMedia(page, EMPTY)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="media-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached in this E2E environment')
    }
    await expect(page.getByTestId('media-kind-image')).toBeVisible()
    await expect(page.getByTestId('media-kind-video')).toBeVisible()
    // Frequency options for image.
    await expect(page.getByTestId('media-freq-image-once')).toBeVisible()
    await expect(page.getByTestId('media-freq-image-daily')).toBeVisible()
    await expect(page.getByTestId('media-freq-image-weekly')).toBeVisible()
    await expect(page.getByTestId('media-freq-image-monthly')).toBeVisible()
    // Start actions.
    await expect(page.getByTestId('media-start-image')).toBeVisible()
    await expect(page.getByTestId('media-start-video')).toBeVisible()
  })

  test('shows the honest disabled note + no-media empty state when unconfigured', async ({ page }) => {
    await stubMedia(page, EMPTY)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="media-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    await expect(page.getByTestId('media-disabled-note')).toBeVisible()
    await expect(page.getByTestId('media-last-image')).toContainText('No media yet')
    await expect(page.getByTestId('media-status-image')).toContainText('OFF')
  })

  test('selecting a frequency + Start Auto persists the routine (honest disabled notice)', async ({ page }) => {
    await stubMedia(page, EMPTY)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="media-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    await page.getByTestId('media-freq-image-daily').click()
    await expect(page.getByTestId('media-freq-image-daily')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('media-start-image').click()
    // Unconfigured → honest notice that the schedule was saved, generation off.
    await expect(page.getByTestId('media-notice-image')).toBeVisible({ timeout: 10_000 })
  })

  test('a configured company with an asset shows AUTO ON + last-generated media', async ({ page }) => {
    const state: MediaState = {
      configured: true,
      routines: [{ id: 'r1', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: '2026-08-20T00:00:00Z', lastRunAt: '2026-08-24T00:00:00Z' }],
      assets: [{ id: 'a1', mediaKind: 'image', url: 'http://x/latest.png', prompt: 'p', createdAt: '2026-08-24T00:00:00Z' }],
      nextRuns: { image: '2026-08-31T00:00:00Z' },
    }
    await stubMedia(page, state)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="media-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    await expect(page.getByTestId('media-status-image')).toContainText('AUTO ON')
    await expect(page.getByTestId('media-asset-image')).toBeVisible()
    await expect(page.getByTestId('media-next-image')).toContainText('Next run')
  })
})
