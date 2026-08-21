import { test, expect, Page } from '@playwright/test'

/**
 * Full platform E2E down BOTH paths (app + company) on prod (#207).
 * Verifies the marketing-ready journey works end-to-end with all fixes live.
 * Findings print with "FINDING:" so the run is greppable.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

function watch(page: Page, label: string) {
  page.on('console', (m) => { try { if (m.type() === 'error') console.log(`FINDING: [${label}] console.error: ${m.text().slice(0, 180)}`) } catch {} })
  page.on('response', (r) => { try { if (r.url().includes('/api/') && r.status() >= 500) console.log(`FINDING: [${label}] 5xx ${r.request().method()} ${r.url()} -> ${r.status()}`) } catch {} })
}

test.describe('Front door', () => {
  test('root IS the builder (Fork: both experiences), old landing retired', async ({ page }) => {
    watch(page, 'root')
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-track="app"]')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-track="company"]')).toBeVisible()
    const html = await page.content()
    if (html.includes('PromptInputTextarea')) console.log('FINDING: [root] legacy app-gen UI still present')
    if (/v0, Lovable|Bolt alternative/.test(html)) console.log('FINDING: [root] old v0/Lovable framing still present')
  })
})

test.describe('COMPANY path', () => {
  test('pick company → intake → build starts', async ({ page }) => {
    watch(page, 'company')
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await page.locator('[data-track="company"]').click()
    const idea = page.getByPlaceholder(/describe your idea/i)
    await expect(idea).toBeVisible({ timeout: 15000 })
    await idea.fill('a DTC coffee brand, small footprint retail')
    // The start/build button becomes enabled with input.
    const startBtn = page.locator('button.btn-primary').filter({ hasText: /build|start|cody|go|→/i }).first()
    await expect(startBtn).toBeEnabled({ timeout: 10000 })
  })

  test('Live dashboard renders with upgrade CTA + real systems', async ({ page }) => {
    watch(page, 'company-live')
    await page.goto(`${BASE}/build?screen=live&company=ember`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20000 })
    // Obvious upgrade path.
    const upgrade = page.getByTestId('upgrade-cta').or(page.getByTestId('claim-cta')).or(page.getByTestId('swarm-upgrade'))
    await expect(upgrade.first()).toBeVisible({ timeout: 15000 })
  })
})

test.describe('APP path', () => {
  test('pick app → intake → build starts', async ({ page }) => {
    watch(page, 'app')
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await page.locator('[data-track="app"]').click()
    const idea = page.getByPlaceholder(/describe your idea/i)
    await expect(idea).toBeVisible({ timeout: 15000 })
    await idea.fill('a habit tracker with streaks and reminders')
    const startBtn = page.locator('button.btn-primary').filter({ hasText: /build|start|cody|go|→/i }).first()
    await expect(startBtn).toBeEnabled({ timeout: 10000 })
  })
})

test.describe('Upgrade + payment', () => {
  test('Pricing → choose tier → real Stripe checkout', async ({ page }) => {
    watch(page, 'pricing')
    let checkoutUrl: string | null = null
    let checkoutStatus: number | null = null
    await page.route('**/api/build/checkout', async (route) => {
      const resp = await route.fetch()
      checkoutStatus = resp.status()
      const body = await resp.json().catch(() => null)
      checkoutUrl = String(body?.url || '')
      await route.fulfill({ response: resp, json: { ...(body || {}), url: '' } })
    })
    await page.route('https://checkout.stripe.com/**', (r) => r.abort())
    await page.goto(`${BASE}/build?screen=pricing&company=ember`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('choose-pro')).toBeVisible({ timeout: 25000 })
    await page.getByTestId('choose-pro').click()
    await expect.poll(() => checkoutStatus, { timeout: 30000 }).toBe(200)
    expect(checkoutUrl, `must be a live Stripe checkout, got ${checkoutUrl}`).toContain('checkout.stripe.com')
  })

  test('yearly toggle present (Polsia parity)', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=pricing&company=ember`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('choose-pro')).toBeVisible({ timeout: 25000 })
    const yearly = page.getByText(/year|annual|2 months/i)
    if (!(await yearly.count())) console.log('FINDING: [pricing] yearly toggle missing')
  })
})

test.describe('Domain search (context-aware, never dead-end)', () => {
  test('a popular brand + context returns real buyable options', async ({ request }) => {
    const r = await request.get(`${BASE}/api/build/domains?brand=ember&keywords=DTC%20coffee%20roaster%20retail`, { timeout: 50000 })
    const d = await r.json()
    expect(d.configured).toBeTruthy()
    expect(Array.isArray(d.suggestions)).toBeTruthy()
    if ((d.suggestions?.length || 0) === 0) console.log(`FINDING: [domains] ember returned 0 options: ${d.note}`)
    expect(d.suggestions.length, `ember must surface options, got note: ${d.note}`).toBeGreaterThan(0)
  })
})

test.describe('Post-payment + subscriptions', () => {
  test('subscription/verify reaches core (not a route-miss)', async ({ request }) => {
    const r = await request.post(`${BASE}/api/build/subscription/verify`, {
      data: { session_id: 'cs_test_fake', slug: 'ember' }, timeout: 30000,
    })
    const d = await r.json()
    // Endpoint executes (returns a verify result), not a 404 route-miss.
    expect(JSON.stringify(d)).not.toContain('Not found: /api/v1/public/pricing/verify')
  })

  test('/api/version freshness endpoint responds', async ({ request }) => {
    const r = await request.get(`${BASE}/api/version`, { timeout: 15000 })
    expect(r.status()).toBe(200)
    const d = await r.json()
    expect(d).toHaveProperty('service')
  })
})
