import { test, expect, Page } from '@playwright/test'

/**
 * Full customer-path UX/UI trace (#207). Walks the exact paths a customer takes,
 * captures screenshots at each step, and records findings (console errors, dead
 * links, missing feedback, broken states) so we surface issues before customers.
 *
 * Runs against prod (PLAYWRIGHT_BASE_URL). Findings are logged with a "FINDING:"
 * prefix so the run output is greppable.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'
const SHOT = 'e2e/ux-shots'

// Collect page console errors + failed requests per test.
function watch(page: Page, label: string) {
  page.on('console', (m) => { try { if (m.type() === 'error') console.log(`FINDING: [${label}] console.error: ${m.text().slice(0, 200)}`) } catch {} })
  page.on('requestfailed', (r) => {
    try {
      const u = r.url()
      if (/ainative\.studio|localhost/.test(u)) {
        const err = r.failure() ? r.failure()!.errorText : 'failed'
        console.log(`FINDING: [${label}] request FAILED: ${r.request().method()} ${u} — ${err}`)
      }
    } catch {}
  })
  page.on('response', (r) => { try { if (r.url().includes('/api/') && r.status() >= 500) console.log(`FINDING: [${label}] 5xx: ${r.request().method()} ${r.url()} -> ${r.status()}`) } catch {} })
}

test.describe('UX trace — company track', () => {
  test('Fork screen — entry point', async ({ page }) => {
    watch(page, 'fork')
    await page.goto(`${BASE}/build`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${SHOT}/01-fork.png`, fullPage: true })
    // Both tracks + clear CTAs.
    await expect(page.locator('[data-track="app"]')).toBeVisible()
    await expect(page.locator('[data-track="company"]')).toBeVisible()
    // FINDING check: are the CTA buttons obvious?
    const appBtn = page.locator('[data-track="app"] button')
    const coBtn = page.locator('[data-track="company"] button')
    if (!(await appBtn.isVisible())) console.log('FINDING: [fork] app track has no visible CTA button')
    if (!(await coBtn.isVisible())) console.log('FINDING: [fork] company track has no visible CTA button')
  })

  test('Intake — describe idea', async ({ page }) => {
    watch(page, 'intake')
    await page.goto(`${BASE}/build`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await page.locator('[data-track="company"]').click()
    const idea = page.getByPlaceholder(/describe your idea/i)
    await expect(idea).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: `${SHOT}/02-intake-empty.png`, fullPage: true })
    // The start button should be disabled until there's input (good UX).
    const startBtn = page.locator('button.btn-primary').filter({ hasText: /start|build|go|cody/i }).first()
    await idea.fill('a CRM for the music industry')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SHOT}/03-intake-filled.png`, fullPage: true })
  })

  test('Pricing — the upgrade decision', async ({ page }) => {
    watch(page, 'pricing')
    await page.goto(`${BASE}/build?screen=pricing&company=riff`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('choose-pro')).toBeVisible({ timeout: 25000 })
    await page.screenshot({ path: `${SHOT}/04-pricing.png`, fullPage: true })
    // All three tiers + a yearly toggle? (Polsia has one; note if we don't.)
    const yearly = page.getByText(/year|annual|2 months/i)
    if (!(await yearly.count())) console.log('FINDING: [pricing] no yearly/annual toggle (Polsia offers "2 months free")')
    // Ownership messaging present? (our differentiator)
    const own = page.getByText(/own 100|no revenue share|your own/i)
    if (!(await own.count())) console.log('FINDING: [pricing] missing ownership/differentiator copy')
  })

  test('Live — the built company dashboard', async ({ page }) => {
    watch(page, 'live')
    await page.goto(`${BASE}/build?screen=live&company=riff`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${SHOT}/05-live.png`, fullPage: true })
    // The upgrade CTA must be obvious (the founder's reported gap).
    const upgrade = page.getByTestId('upgrade-cta').or(page.getByTestId('claim-cta')).or(page.getByTestId('swarm-upgrade'))
    if (!(await upgrade.first().isVisible())) console.log('FINDING: [live] NO visible upgrade/claim CTA — the reported gap')
    // Business systems cards: do links work or dead-end?
    const systems = page.locator('.m-system')
    const n = await systems.count()
    console.log(`FINDING-INFO: [live] ${n} business-system cards rendered`)
    // Disabled buttons are OK only if clearly labeled "coming soon" (#256 fix).
    // Flag any disabled button that ISN'T labeled — those read as dead affordances.
    const disabledBtns = page.locator('button[disabled]')
    const dn = await disabledBtns.count()
    for (let i = 0; i < dn; i++) {
      const b = disabledBtns.nth(i)
      const txt = ((await b.textContent()) || '').toLowerCase()
      const title = ((await b.getAttribute('title')) || '').toLowerCase()
      const labeled = /soon|coming|provision|✓/.test(txt) || /soon|coming|provision/.test(title)
      if (!labeled) console.log(`FINDING: [live] unlabeled disabled button (dead affordance): "${(await b.textContent())?.trim()}"`)
    }
  })

  test('Live — infra / custom domain modal', async ({ page }) => {
    watch(page, 'domain-modal')
    await page.goto(`${BASE}/build?screen=live&company=riff`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(1500)
    // Find the "Get a custom domain" button and open the modal.
    const domBtn = page.getByRole('button', { name: /custom domain|get a domain|add.*domain/i }).first()
    if (await domBtn.isVisible().catch(() => false)) {
      await domBtn.click()
      await page.waitForTimeout(3000)
      await page.screenshot({ path: `${SHOT}/06-domain-modal.png`, fullPage: true })
      // Are real, buyable options shown (the earlier bug)?
      const opts = page.locator('.m-domain-opt')
      const on = await opts.count()
      console.log(`FINDING-INFO: [domain-modal] ${on} domain options shown`)
      if (on === 0) console.log('FINDING: [domain-modal] no domain options rendered')
    } else {
      console.log('FINDING: [live] could not find a "Get a custom domain" button')
    }
  })
})

test.describe('UX trace — app track', () => {
  test('App track — pick + intake', async ({ page }) => {
    watch(page, 'app-track')
    await page.goto(`${BASE}/build`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await page.locator('[data-track="app"]').click()
    await expect(page.getByPlaceholder(/describe your idea/i)).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: `${SHOT}/07-app-intake.png`, fullPage: true })
  })
})
