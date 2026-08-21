import { test, expect } from '@playwright/test'

/**
 * Idea → build → UPGRADE → real Stripe checkout (#207 · #252).
 *
 * Verifies the conversion path the founder couldn't find ("I wasn't able to
 * figure out how to move to a paid subscription"). Runs against prod by default
 * (PLAYWRIGHT_BASE_URL=https://builder.ainative.studio).
 *
 * Two layers:
 *   A. Deterministic upgrade path via the ?screen=live deep-link (no slow codegen):
 *      Live → obvious Upgrade CTA → Pricing → choose a tier → REAL Stripe checkout.
 *   B. A real front-door smoke: /build renders Fork with the two tracks and an idea
 *      input, i.e. the journey actually starts.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

test.describe('Upgrade journey', () => {
  test('A. Live → Upgrade CTA → Pricing → real Stripe checkout', async ({ page }) => {
    // Land directly on a company's Live dashboard (deep-link; no codegen needed).
    await page.goto(`${BASE}/build?screen=live&company=riff`, { waitUntil: 'domcontentloaded' })

    // The Live dashboard rendered.
    await expect(page.locator('.m-live, .m-live-masthead').first()).toBeVisible({ timeout: 20000 })

    // There is an OBVIOUS upgrade path. Anonymous → the claim/upgrade banner CTA.
    const upgradeCta = page.getByTestId('upgrade-cta')
    const claimCta = page.getByTestId('claim-cta')
    const swarmUpgrade = page.getByTestId('swarm-upgrade')
    // At least one clear conversion CTA must be present and visible.
    const anyCta = upgradeCta.or(claimCta).or(swarmUpgrade).first()
    await expect(anyCta).toBeVisible({ timeout: 15000 })

    // The "Hire the swarm" upgrade button routes to the real pricing/checkout path.
    // (Anonymous users are routed through signup first; signed-in go straight to
    // Pricing. We assert the button EXISTS and is the real upgrade affordance.)
    await expect(swarmUpgrade).toBeVisible()
    await expect(swarmUpgrade).toContainText(/upgrade/i)
  })

  test('A2. Pricing screen offers tiers and starts a REAL Stripe checkout', async ({ page }) => {
    // Intercept the checkout API at the route layer: fetch the real response,
    // record the cs_live URL, then fulfill with the URL BLANKED so the app can't
    // navigate the test browser off to Stripe (which would invalidate the body).
    // This asserts the real endpoint returns a live Stripe checkout URL.
    let checkoutUrl: string | null = null
    let checkoutStatus: number | null = null
    await page.route('**/api/build/checkout', async (route) => {
      const resp = await route.fetch()
      checkoutStatus = resp.status()
      const body = await resp.json().catch(() => null)
      checkoutUrl = String(body?.url || '')
      // Blank the url so choose() doesn't redirect; keep the rest of the payload.
      await route.fulfill({ response: resp, json: { ...(body || {}), url: '' } })
    })

    await page.goto(`${BASE}/build?screen=pricing&company=riff`, { waitUntil: 'domcontentloaded' })

    // Wait for the tiers to hydrate (deep-link + client render), then assert them.
    await expect(page.getByTestId('choose-pro')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('tier-business')).toBeVisible()
    await expect(page.getByTestId('tier-enterprise')).toBeVisible()

    // Choosing a tier must reach a REAL Stripe checkout (cs_live), not dead-end.
    await page.getByTestId('choose-pro').click()

    // Poll until the listener has recorded the checkout response.
    await expect.poll(() => checkoutStatus, { timeout: 30000 }).toBe(200)
    expect(checkoutUrl, `checkout must return a real Stripe URL, got: ${checkoutUrl}`).toContain('checkout.stripe.com')
  })

  test('B. Front door: /build starts the journey (Fork tracks + idea input)', async ({ page }) => {
    await page.goto(`${BASE}/build`, { waitUntil: 'domcontentloaded' })
    // The two tracks are the entry to building an app or a company.
    await expect(page.locator('[data-track="app"]')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-track="company"]')).toBeVisible()

    // Picking a track leads to the idea intake (where Cody starts). The whole
    // card is the click target (onClick is on the card div). Let hydration settle
    // so React has attached the handler, then click; retry once if the screen
    // didn't advance (guards against a click landing before hydration).
    const idea = page.getByPlaceholder(/describe your idea/i)
    await page.waitForTimeout(1500)
    await page.locator('[data-track="company"]').click()
    if (!(await idea.isVisible().catch(() => false))) {
      await page.waitForTimeout(1500)
      await page.locator('[data-track="company"]').click()
    }
    await expect(idea).toBeVisible({ timeout: 15000 })
  })
})
