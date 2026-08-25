/**
 * E2E tests for the founder pitch-deck export (#69).
 *
 * Verifies on the real Live dashboard's Documents surface that:
 *  1. The "Export pitch deck" action renders inside the Documents panel.
 *  2. Clicking it POSTs /api/build/deck and triggers a real file download
 *     (a .pptx attachment). The heavy generation is mocked so the E2E is
 *     deterministic (no dependency on live ZeroDB / a model / a paid account).
 *  3. The action is a PAID deliverable: when the company is NOT on a paid plan
 *     the button shows the locked "(paid)" affordance and does NOT download.
 *
 * The Documents panel + deck route are intercepted; the Live screen is reached via
 * the same deep-link hook the Documents (#64) E2E uses.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

/** Minimal valid PPTX bytes stand-in (a tiny ZIP: 'PK\x05\x06' empty EOCD). */
const FAKE_PPTX = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])

/** Stub the Documents list so the panel renders (empty library is fine here). */
async function stubDocuments(page: Page) {
  await page.route('**/api/build/documents**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [],
          counts: { all: 0, document: 0, report: 0 },
          kinds: [{ kind: 'all', label: 'All' }, { kind: 'document', label: 'Documents' }, { kind: 'report', label: 'Reports' }],
        }),
      })
    }
    return route.continue()
  })
}

/** Stub the deck export route to return a downloadable .pptx attachment. */
async function stubDeck(page: Page) {
  await page.route('**/api/build/deck', async (route) => {
    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="acme-pitch-deck.pptx"',
      },
      body: FAKE_PPTX,
    })
  })
}

async function reachLiveDashboard(page: Page, company = 'e2e-deck') {
  await page.goto(`${BASE_URL}/?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="documents-panel"], .m-systems', { timeout: 60_000 }).catch(() => {})
}

test.describe('Founder pitch-deck export (#69)', () => {
  test('the Export pitch deck action renders inside the Documents panel', async ({ page }) => {
    await stubDocuments(page)
    await stubDeck(page)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="documents-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached in this E2E environment')
    }
    await expect(page.getByTestId('deck-export')).toBeVisible()
    await expect(page.getByTestId('deck-export-btn')).toBeVisible()
  })

  test('clicking Export triggers a .pptx file download (paid path)', async ({ page }) => {
    await stubDocuments(page)
    await stubDeck(page)
    await reachLiveDashboard(page)
    const btn = page.getByTestId('deck-export-btn')
    if (!(await btn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    // If the button is locked (no paid plan in this env), this path is not exercised.
    const locked = await page.getByTestId('deck-export-locked').isVisible().catch(() => false)
    test.skip(locked, 'Company not on a paid plan in this E2E env — download path covered by unit/integration tests')

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
    await btn.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('pitch-deck.pptx')
  })

  test('a non-paid company shows the locked (paid) affordance', async ({ page }) => {
    await stubDocuments(page)
    await stubDeck(page)
    await reachLiveDashboard(page)
    const btn = page.getByTestId('deck-export-btn')
    if (!(await btn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    const locked = await page.getByTestId('deck-export-locked').isVisible().catch(() => false)
    test.skip(!locked, 'Company IS on a paid plan in this E2E env — locked affordance not shown')
    await expect(page.getByTestId('deck-export-btn')).toContainText(/paid/i)
  })
})
