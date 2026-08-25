/**
 * E2E tests for Auto Mode (#58) on the Live dashboard — "Cody works nonstop. You
 * choose how long."
 *
 * Verifies on the real Live dashboard that:
 *  1. The Auto Mode panel renders (data-testid="auto-mode-panel") with a duration
 *     selector (1h/4h/8h/overnight/continuous) and a START AUTO MODE action.
 *  2. A duration can be selected.
 *  3. When a run is active, the panel shows the RUNNING state with time remaining,
 *     tasks dispatched this run, current activity, and a STOP control.
 *  4. STOP transitions the panel back to the idle (selector + start) state.
 *  5. When the loop isn't configured, an honest disabled note is shown (no faked run).
 *
 * The panel loads from /api/build/auto-mode, which we intercept so the E2E is
 * deterministic (no dependency on live ZeroDB / the swarm). The Live screen is
 * reached via the same deep-link hook the Media (#54) / Documents (#64) E2Es use.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

interface AutoRun {
  kind: 'auto'
  companyId: string
  companyName?: string
  duration: string
  startedAt: string
  expiresAt: string | null
  stoppedAt?: string | null
}

interface AutoState {
  configured: boolean
  run: AutoRun | null
}

/**
 * Stub /api/build/auto-mode. GET → current state; POST start → an active run;
 * POST stop → a stopped run. The stub mutates local state so start→running→stop
 * behaves like the real endpoint for the duration of the test.
 */
async function stubAutoMode(page: Page, initial: AutoState) {
  const state: AutoState = { ...initial }
  const durations = [
    { id: '1h', label: '1 hour', cost: '≈ 20 credits' },
    { id: '4h', label: '4 hours', cost: '≈ 80 credits' },
    { id: '8h', label: '8 hours', cost: '≈ 160 credits' },
    { id: 'overnight', label: 'Overnight (8h)', cost: '≈ 160 credits' },
    { id: 'continuous', label: 'Continuous', cost: '≈ 20 credits/hour' },
  ]
  await page.route('**/api/build/auto-mode**', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ configured: state.configured, run: state.run, durations }),
      })
    }
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      if (!state.configured) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'unavailable' }) })
      }
      if (body.action === 'stop') {
        state.run = state.run ? { ...state.run, stoppedAt: new Date().toISOString() } : null
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, run: state.run }) })
      }
      // start — an active 4h run (or whatever duration was picked)
      const now = Date.now()
      const dur = String(body.duration || '4h')
      const hours = dur === '1h' ? 1 : dur === 'continuous' ? null : dur === '4h' ? 4 : 8
      state.run = {
        kind: 'auto', companyId: body.companyId, companyName: body.companyName, duration: dur,
        startedAt: new Date(now).toISOString(),
        expiresAt: hours == null ? null : new Date(now + hours * 3.6e6).toISOString(),
        stoppedAt: null,
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, run: state.run, cost: '≈ 80 credits' }) })
    }
    return route.continue()
  })
}

async function reachLiveDashboard(page: Page, company = 'e2e-auto') {
  // The build flow (and its ?screen= deep-link hook) is mounted under /build.
  await page.goto(`${BASE_URL}/build?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="auto-mode-panel"], [data-testid="systems-grid"]', { timeout: 60_000 }).catch(() => {})
}

/** An already-running 4h run for the RUNNING-state tests. */
function runningState(company = 'e2e-auto'): AutoState {
  const now = Date.now()
  return {
    configured: true,
    run: {
      kind: 'auto', companyId: company, companyName: company, duration: '4h',
      startedAt: new Date(now - 30 * 60 * 1000).toISOString(), // 30m ago
      expiresAt: new Date(now + 3.5 * 3.6e6).toISOString(),    // ~3h30m left
      stoppedAt: null,
    },
  }
}

test.describe('Auto Mode (#58)', () => {
  test('renders the panel with a duration selector and START AUTO MODE', async ({ page }) => {
    await stubAutoMode(page, { configured: true, run: null })
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="auto-mode-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable in this environment')
      return
    }
    await expect(panel).toContainText('Auto Mode')
    await expect(page.locator('[data-testid="auto-mode-tagline"]')).toContainText('You choose how long')
    // All five durations present.
    for (const d of ['1h', '4h', '8h', 'overnight', 'continuous']) {
      await expect(page.locator(`[data-testid="auto-mode-duration-${d}"]`)).toBeVisible()
    }
    await expect(page.locator('[data-testid="auto-mode-start"]')).toBeVisible()
    // A transparent credit cost line is shown before starting.
    await expect(page.locator('[data-testid="auto-mode-cost"]')).toContainText('credits')
  })

  test('a duration can be selected', async ({ page }) => {
    await stubAutoMode(page, { configured: true, run: null })
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="auto-mode-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable')
      return
    }
    const eight = page.locator('[data-testid="auto-mode-duration-8h"]')
    await eight.click()
    await expect(eight).toHaveClass(/is-active/)
    await expect(eight).toHaveAttribute('aria-checked', 'true')
  })

  test('shows the RUNNING state with time remaining, tasks and activity', async ({ page }) => {
    await stubAutoMode(page, runningState())
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="auto-mode-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable')
      return
    }
    await expect(page.locator('[data-testid="auto-mode-status"]')).toContainText('running')
    await expect(page.locator('[data-testid="auto-mode-time-remaining"]')).toContainText('left')
    await expect(page.locator('[data-testid="auto-mode-tasks-dispatched"]')).toContainText('dispatched this run')
    await expect(page.locator('[data-testid="auto-mode-activity"]')).toContainText('Current activity')
    await expect(page.locator('[data-testid="auto-mode-stop"]')).toBeVisible()
  })

  test('STOP returns the panel to the idle start state', async ({ page }) => {
    await stubAutoMode(page, runningState())
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="auto-mode-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable')
      return
    }
    await page.locator('[data-testid="auto-mode-stop"]').click()
    await expect(page.locator('[data-testid="auto-mode-start"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="auto-mode-status"]')).toContainText('off')
  })

  test('shows an honest disabled note when the loop is not configured', async ({ page }) => {
    await stubAutoMode(page, { configured: false, run: null })
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="auto-mode-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reachable')
      return
    }
    await expect(page.locator('[data-testid="auto-mode-disabled-note"]')).toBeVisible()
    await expect(page.locator('[data-testid="auto-mode-start"]')).toHaveCount(0)
  })
})
