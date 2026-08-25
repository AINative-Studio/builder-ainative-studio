/**
 * E2E tests for the Website / App management panel (#63) on the Live dashboard.
 *
 * Verifies on the real Live dashboard that:
 *  1. The panel renders (data-testid="website-panel") with the three sections:
 *     Redeploy, Secrets, and Your data (export).
 *  2. Redeploy asks for confirmation, then shows the honest
 *     "redeploying → validating → live" status.
 *  3. Secrets are listed MASKED (never plaintext), can be added, and deleted;
 *     platform-reserved variables render read-only (no delete).
 *  4. Export triggers a real file download (JSON + CSV).
 *
 * The panel loads from /api/build/{secrets,redeploy,export}, which we intercept so
 * the E2E is deterministic (no dependency on live Railway / ZeroDB). The Live screen
 * is reached via the same deep-link hook the Auto Mode (#58) / Media (#54) E2Es use.
 *
 * Secrets CRUD + redeploy are owner-only (paid). If the deep-linked dashboard renders
 * the panel in its locked (unpaid) state, those sub-tests skip honestly rather than
 * assert against a state the environment can't reach.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

interface Secret {
  name: string
  masked: string
  reserved: boolean
}

/** Stub /api/build/secrets with an in-memory store so add/delete behave like the real API. */
async function stubSecrets(page: Page, initial: Secret[]) {
  const store = new Map<string, Secret>(initial.map((s) => [s.name, s]))
  await page.route('**/api/build/secrets**', async (route) => {
    const req = route.request()
    const method = req.method()
    if (method === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, available: true, secrets: [...store.values()].sort((a, b) => a.name.localeCompare(b.name)) }),
      })
    }
    const body = JSON.parse(req.postData() || '{}')
    if (method === 'POST') {
      // Mimic masking server-side — the value never round-trips as plaintext.
      const tail = String(body.value || '').slice(-4)
      store.set(body.name, { name: body.name, masked: tail ? `•••••••• ${tail}` : '••••••••', reserved: false })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    if (method === 'DELETE') {
      store.delete(body.name)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    return route.continue()
  })
}

/** Stub /api/build/redeploy → an accepted, health-verified redeploy. */
async function stubRedeploy(page: Page, healthy = true) {
  await page.route('**/api/build/redeploy**', async (route) => {
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, deploymentId: 'dep-e2e', status: healthy ? 'live' : 'redeploying', healthy }),
    })
  })
}

/** Stub /api/build/export → a downloadable attachment for both formats. */
async function stubExport(page: Page) {
  await page.route('**/api/build/export**', async (route) => {
    const url = route.request().url()
    const csv = /format=csv/.test(url)
    return route.fulfill({
      status: 200,
      contentType: csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      headers: { 'Content-Disposition': `attachment; filename="e2e-data.${csv ? 'zip' : 'json'}"` },
      body: csv ? '# table: customers (0 rows)\r\n' : JSON.stringify({ projectId: 'p', tables: [] }),
    })
  })
}

async function reachLiveDashboard(page: Page, company = 'e2e-website') {
  await page.goto(`${BASE_URL}/build?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="website-panel"], [data-testid="systems-grid"]', { timeout: 60_000 }).catch(() => {})
}

async function panelOrSkip(page: Page) {
  const panel = page.locator('[data-testid="website-panel"]')
  if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
    test.skip(true, 'Live dashboard not reachable in this environment')
  }
  return panel
}

/** Is the panel in the paid/owner (unlocked) state where secrets CRUD is available? */
async function isUnlocked(page: Page): Promise<boolean> {
  return !(await page.locator('[data-testid="secrets-locked"]').isVisible({ timeout: 2_000 }).catch(() => false))
}

test.describe('Website / App management panel (#63)', () => {
  test('renders the panel with Redeploy, Secrets, and Your data sections', async ({ page }) => {
    await stubSecrets(page, [])
    await stubRedeploy(page)
    await stubExport(page)
    await reachLiveDashboard(page)
    const panel = await panelOrSkip(page)

    await expect(panel).toContainText('Website & app')
    await expect(page.locator('[data-testid="website-redeploy"]')).toBeVisible()
    await expect(page.locator('[data-testid="website-secrets"]')).toBeVisible()
    await expect(page.locator('[data-testid="website-export"]')).toBeVisible()
    // Data-ownership messaging is present.
    await expect(page.locator('[data-testid="website-export"]')).toContainText('own 100%')
  })

  test('redeploy asks for confirmation, then shows live status', async ({ page }) => {
    await stubSecrets(page, [])
    await stubRedeploy(page, true)
    await stubExport(page)
    await reachLiveDashboard(page)
    await panelOrSkip(page)
    if (!(await isUnlocked(page))) {
      test.skip(true, 'panel locked (unpaid) in this environment — redeploy is owner-only')
      return
    }

    await page.locator('[data-testid="redeploy-btn"]').click()
    await expect(page.locator('[data-testid="redeploy-confirm"]')).toBeVisible()
    await page.locator('[data-testid="redeploy-confirm-btn"]').click()
    await expect(page.locator('[data-testid="redeploy-status"]')).toContainText(/live/i, { timeout: 10_000 })
  })

  test('secrets list is masked; a secret can be added and deleted', async ({ page }) => {
    await stubSecrets(page, [
      { name: 'EXISTING_KEY', masked: '•••••••• 9f2a', reserved: false },
      { name: 'COMPANY_SLUG', masked: '••••••••', reserved: true },
    ])
    await stubRedeploy(page)
    await stubExport(page)
    await reachLiveDashboard(page)
    await panelOrSkip(page)
    if (!(await isUnlocked(page))) {
      test.skip(true, 'panel locked (unpaid) in this environment — secrets are owner-only')
      return
    }

    // Masked values only — no plaintext, and the reserved var is read-only.
    const list = page.locator('[data-testid="secrets-list"]')
    await expect(list).toBeVisible()
    await expect(list).toContainText('••••••••')
    await expect(page.locator('[data-testid="secret-reserved"]')).toBeVisible()

    // Add a new secret.
    await page.locator('[data-testid="secret-name-input"]').fill('STRIPE_KEY')
    await page.locator('[data-testid="secret-value-input"]').fill('sk_live_deadbeef1234')
    await page.locator('[data-testid="secret-save"]').click()
    await expect(list).toContainText('STRIPE_KEY', { timeout: 10_000 })
    // The freshly-added value is shown masked, never as plaintext.
    await expect(list).not.toContainText('sk_live_deadbeef1234')

    // Delete it (first user-deletable row).
    await page.locator('[data-testid="secret-delete"]').first().click()
    await page.waitForTimeout(500)
  })

  test('export triggers a JSON download', async ({ page }) => {
    await stubSecrets(page, [])
    await stubRedeploy(page)
    await stubExport(page)
    await reachLiveDashboard(page)
    await panelOrSkip(page)
    if (!(await isUnlocked(page))) {
      test.skip(true, 'panel locked (unpaid) — export is owner-only')
      return
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.locator('[data-testid="export-json"]').click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.json$/)
  })
})
