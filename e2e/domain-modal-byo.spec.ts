/**
 * E2E: DomainModal — bring your own domain / connect existing (#53)
 *
 * Validates the connect-existing flow:
 *  1. A "Connect a domain you own" tab exists alongside "Buy a domain", giving the
 *     three paths (default subdomain + BYO + buy).
 *  2. Entering a domain shows the exact DNS records to add, each with a Copy button.
 *  3. Honest status states render: pending → verifying → live (TLS) — and 'live'
 *     hides the DNS records (nothing left to do).
 *  4. A non-provisioned company surfaces "needs provision" instead of records.
 *  5. Switching to the BYO tab does NOT disturb the #48 buy-flow scroll body.
 *
 * The Railway/DNS calls are mocked at the /api/build/connect-domain route so the spec
 * never touches real infrastructure. Runs against the isolated test harness at
 * /test-components/domain-modal (brand/slug = "acme").
 */

import { test, expect, type Page, type Route } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const CNAME_TARGET = 'acme.up.railway.app'
const DNS_RECORDS = [
  { type: 'CNAME', name: 'myco.com', value: CNAME_TARGET, status: 'WAITING' },
  { type: 'TXT', name: '_railway-verify.myco.com', value: 'railway-verify=abc123', status: 'WAITING' },
]

/** Mock the buy-domain route (needed so the modal opens without a real /domains call). */
async function mockBuyApi(page: Page) {
  await page.route('**/api/build/domains**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        suggestions: [
          { domain: 'acme.com', available: true, price: 12 },
          { domain: 'acme.io', available: true, price: 20 },
        ],
      }),
    })
  })
}

/**
 * Mock the connect-domain route. `opts.status` controls the POST/GET status the modal
 * sees; `opts.provisioned` toggles the needs_provision branch; `opts.preConnected`
 * makes the on-open GET report an already-connected domain (idempotency test).
 */
async function mockConnectApi(
  page: Page,
  opts: { status?: string; provisioned?: boolean; preConnected?: boolean } = {},
) {
  const { status = 'verifying', provisioned = true, preConnected = false } = opts
  await page.route('**/api/build/connect-domain**', async (route: Route) => {
    const req = route.request()
    const method = req.method()

    if (method === 'POST') {
      if (!provisioned) {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: false, needs_provision: true, detail: 'Provision first.' }),
        })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, domain: 'myco.com', status, dnsRecords: DNS_RECORDS, cnameTarget: CNAME_TARGET }),
      })
      return
    }

    // GET — on-open status probe + polling
    if (preConnected) {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, connected: true, domain: 'myco.com', status, dnsRecords: status === 'live' ? [] : DNS_RECORDS, cnameTarget: CNAME_TARGET }),
      })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, connected: false, status: null }),
    })
  })
}

async function openHarness(page: Page): Promise<number> {
  const res = await page.goto(`${BASE_URL}/test-components/domain-modal`, { waitUntil: 'networkidle', timeout: 30_000 })
  return res?.status() ?? 0
}

test.describe('DomainModal — BYO tab present (three paths) (#53)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await mockBuyApi(page)
  })

  test('both Buy and Connect tabs are visible', async ({ page }) => {
    await mockConnectApi(page)
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    await expect(page.locator('[data-testid="domain-tab-buy"]')).toBeVisible()
    await expect(page.locator('[data-testid="domain-tab-byo"]')).toBeVisible()
  })

  test('switching to BYO shows the connect panel and input', async ({ page }) => {
    await mockConnectApi(page)
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    await page.locator('[data-testid="domain-tab-byo"]').click()
    await expect(page.locator('[data-testid="domain-byo-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid="byo-domain-input"]')).toBeVisible()
  })
})

test.describe('DomainModal — BYO connect flow: records + copy + status (#53)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await mockBuyApi(page)
  })

  test('entering a domain reveals the DNS records with copy buttons', async ({ page }) => {
    await mockConnectApi(page, { status: 'verifying' })
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    await page.locator('[data-testid="domain-tab-byo"]').click()
    await page.locator('[data-testid="byo-domain-input"]').fill('myco.com')
    await page.locator('[data-testid="byo-connect-cta"]').click()

    const records = page.locator('[data-testid="byo-dns-records"]')
    await expect(records).toBeVisible({ timeout: 10_000 })
    // CNAME target + verify TXT both present
    await expect(records).toContainText(CNAME_TARGET)
    await expect(records).toContainText('railway-verify=abc123')
    // Each record has a copy button
    await expect(page.locator('[data-testid="byo-copy-0"]')).toBeVisible()
    await expect(page.locator('[data-testid="byo-copy-1"]')).toBeVisible()
  })

  test('copy button copies the record value to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockConnectApi(page, { status: 'verifying' })
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    await page.locator('[data-testid="domain-tab-byo"]').click()
    await page.locator('[data-testid="byo-domain-input"]').fill('myco.com')
    await page.locator('[data-testid="byo-connect-cta"]').click()
    await page.locator('[data-testid="byo-copy-0"]').click()

    await expect(page.locator('[data-testid="byo-copy-0"]')).toContainText('Copied')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(CNAME_TARGET)
  })

  test('shows the verifying status (cert issuing) — not a false "live"', async ({ page }) => {
    await mockConnectApi(page, { status: 'verifying' })
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    await page.locator('[data-testid="domain-tab-byo"]').click()
    await page.locator('[data-testid="byo-domain-input"]').fill('myco.com')
    await page.locator('[data-testid="byo-connect-cta"]').click()

    const statusEl = page.locator('[data-testid="byo-status"]')
    await expect(statusEl).toBeVisible({ timeout: 10_000 })
    await expect(statusEl).toHaveAttribute('data-status', 'verifying')
    await expect(statusEl).toContainText('certificate')
  })

  test('shows pending status when DNS records are not yet detected', async ({ page }) => {
    await mockConnectApi(page, { status: 'pending' })
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    await page.locator('[data-testid="domain-tab-byo"]').click()
    await page.locator('[data-testid="byo-domain-input"]').fill('myco.com')
    await page.locator('[data-testid="byo-connect-cta"]').click()

    const statusEl = page.locator('[data-testid="byo-status"]')
    await expect(statusEl).toHaveAttribute('data-status', 'pending', { timeout: 10_000 })
  })

  test('live status hides the DNS records (nothing left to do)', async ({ page }) => {
    // Pre-connected + live via the on-open GET so we land straight in the live state.
    await mockConnectApi(page, { status: 'live', preConnected: true })
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    const statusEl = page.locator('[data-testid="byo-status"]')
    await expect(statusEl).toBeVisible({ timeout: 10_000 })
    await expect(statusEl).toHaveAttribute('data-status', 'live')
    await expect(statusEl).toContainText('live')
    // Records are hidden once live
    await expect(page.locator('[data-testid="byo-dns-records"]')).toHaveCount(0)
  })
})

test.describe('DomainModal — BYO edge cases (#53)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await mockBuyApi(page)
  })

  test('non-provisioned company prompts to provision first', async ({ page }) => {
    await mockConnectApi(page, { provisioned: false })
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    await page.locator('[data-testid="domain-tab-byo"]').click()
    await page.locator('[data-testid="byo-domain-input"]').fill('myco.com')
    await page.locator('[data-testid="byo-connect-cta"]').click()

    await expect(page.locator('[data-testid="byo-needs-provision"]')).toBeVisible({ timeout: 10_000 })
  })

  test('idempotent re-open: already-connected domain surfaces on the BYO tab', async ({ page }) => {
    await mockConnectApi(page, { status: 'verifying', preConnected: true })
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    // The on-open GET reports a connected domain, so the modal auto-selects the BYO tab
    // and shows its status without any interaction.
    const statusEl = page.locator('[data-testid="byo-status"]')
    await expect(statusEl).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="byo-domain-input"]')).toHaveValue('myco.com')
  })

  test('switching to BYO preserves the #48 buy-flow scroll body when switching back', async ({ page }) => {
    await mockConnectApi(page)
    const status = await openHarness(page)
    test.skip(status === 404, 'Test harness page not wired')

    // Buy tab first — scroll body present (the #48 invariant).
    await expect(page.locator('[data-testid="domain-scroll-body"]')).toBeVisible()
    // Switch to BYO, then back to Buy.
    await page.locator('[data-testid="domain-tab-byo"]').click()
    await expect(page.locator('[data-testid="domain-byo-panel"]')).toBeVisible()
    await page.locator('[data-testid="domain-tab-buy"]').click()
    // The #48 scroll body is intact after round-tripping the tabs.
    const scrollBody = page.locator('[data-testid="domain-scroll-body"]')
    await expect(scrollBody).toBeVisible()
    const maxHeight = await scrollBody.evaluate((el) => window.getComputedStyle(el).maxHeight)
    expect(maxHeight).not.toBe('none')
  })
})
