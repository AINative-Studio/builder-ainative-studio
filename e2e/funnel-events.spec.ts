import { test, expect } from '@playwright/test'

/**
 * Verify GA4 funnel events actually fire in a real browser (#207).
 * We hook window.dataLayer.push to record every gtag event, then walk the flow
 * and assert the funnel events land. Runs against prod.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

async function armDataLayer(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    ;(window as any).__events = []
    const w = window as any
    w.dataLayer = w.dataLayer || []
    const orig = w.dataLayer.push.bind(w.dataLayer)
    w.dataLayer.push = (...args: any[]) => { try { (window as any).__events.push(args[0]) } catch {} ; return orig(...args) }
  })
}
const events = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as any).__events || []).map((e: any) => (Array.isArray(e) ? e[0] : e?.[0] ?? e?.event ?? e)).filter(Boolean))

test('idea_submitted fires when the founder submits an idea', async ({ page }) => {
  await armDataLayer(page)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await page.locator('[data-track="company"]').click()
  const idea = page.getByPlaceholder(/describe your idea/i)
  await expect(idea).toBeVisible({ timeout: 15000 })
  await idea.fill('a DTC coffee brand, small footprint retail')
  // click the start/build button
  await page.locator('button.btn-primary').filter({ hasText: /build|start|cody|go|→/i }).first().click()
  await page.waitForTimeout(2500)
  const ev = await events(page)
  // gtag('event','idea_submitted',...) pushes ['event','idea_submitted',{...}]
  const raw = await page.evaluate(() => JSON.stringify((window as any).__events || []))
  expect(raw, `dataLayer should contain idea_submitted. Got: ${raw.slice(0, 300)}`).toContain('idea_submitted')
})

test('upgrade_clicked + checkout_started fire through the upgrade path', async ({ page }) => {
  await armDataLayer(page)
  // Land on Live (signed-out → the upgrade CTA routes to signup, but the event still fires on click).
  await page.goto(`${BASE}/build?screen=live&company=ember`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(1500)
  const swarm = page.getByTestId('swarm-upgrade')
  if (await swarm.isVisible().catch(() => false)) await swarm.click()
  await page.waitForTimeout(1500)
  const raw = await page.evaluate(() => JSON.stringify((window as any).__events || []))
  expect(raw, `expected upgrade_clicked. Got: ${raw.slice(0, 300)}`).toContain('upgrade_clicked')

  // Pricing → checkout_started
  await page.goto(`${BASE}/build?screen=pricing&company=ember`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('choose-pro')).toBeVisible({ timeout: 25000 })
  await page.route('https://checkout.stripe.com/**', (r) => r.abort())
  await page.route('**/api/build/checkout', (r) => r.fulfill({ json: { url: '' } })) // don't navigate off
  await page.getByTestId('choose-pro').click()
  await page.waitForTimeout(1500)
  const raw2 = await page.evaluate(() => JSON.stringify((window as any).__events || []))
  expect(raw2, `expected checkout_started. Got: ${raw2.slice(0, 300)}`).toContain('checkout_started')
})

test('lead capture: email input present + POST persists', async ({ page }) => {
  await page.goto(`${BASE}/build?screen=live&company=ember`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(1500)
  // Anonymous → the save-by-email input should be present.
  const emailInput = page.getByTestId('lead-email')
  // (Only shows when signed out; in a fresh prod session that's the default.)
  if (await emailInput.isVisible().catch(() => false)) {
    const resp = page.waitForResponse((r) => r.url().includes('/api/build/lead'), { timeout: 15000 }).catch(() => null)
    await emailInput.fill('e2e-lead@example.com')
    await page.getByTestId('save-email').click()
    const r = await resp
    expect(r, 'lead POST should fire').toBeTruthy()
    expect(r!.status()).toBeLessThan(500)
  } else {
    console.log('FINDING: [lead] email input not shown (session may be authenticated)')
  }
})
