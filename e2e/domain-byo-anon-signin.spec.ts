/**
 * Regression: BYO "Connect a domain you own" must route an ANONYMOUS founder to
 * sign-in, not dead-end on a passive message (the reported bug — fixed in 9b21b96).
 *
 * Runs against PRODUCTION by default because the DomainModal tabs do NOT render in
 * the local dev/build environment (tracked in #292); they render correctly on prod.
 * Override the target with PLAYWRIGHT_BASE_URL once #292 is fixed and this can run
 * locally against the /build flow.
 *
 * This is intentionally an unauthenticated flow (no seeded account needed): the
 * whole point is the signed-out path. It navigates to a real company's Live
 * dashboard, opens the domain modal, switches to the BYO tab, and asserts:
 *   1. The Connect CTA signals the sign-in intent ("Sign in to connect").
 *   2. Clicking it lands the founder on the signup screen (routes to auth), rather
 *      than silently doing nothing.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'
// A real, registered company slug whose Live dashboard is reachable. `spinwave`
// was the company in the original bug report.
const COMPANY = process.env.BYO_TEST_COMPANY || 'spinwave'

test('anonymous BYO Connect routes to sign-in (not a dead-end)', async ({ page }) => {
  await page.goto(`${BASE}/build?screen=live&company=${COMPANY}&track=app`, {
    waitUntil: 'networkidle', timeout: 45_000,
  })
  await page.waitForTimeout(3_000)

  // Open the custom-domain modal from the Live dashboard.
  const openBtn = page.getByRole('button', { name: /custom domain/i })
  await expect(openBtn.first()).toBeVisible({ timeout: 15_000 })
  await openBtn.first().click()

  // The tabs must be present (guards against the #292 non-render regression too).
  const byoTab = page.locator('[data-testid="domain-tab-byo"]')
  await expect(byoTab).toBeVisible({ timeout: 10_000 })
  await byoTab.click()

  // 1. The CTA signals sign-in intent when signed out.
  const cta = page.locator('[data-testid="byo-connect-cta"]')
  await expect(cta).toHaveText(/sign in to connect/i)

  // 2. Entering a domain + clicking routes to the signup screen (the fix), instead
  //    of stranding the founder on a passive "please sign in" message.
  await page.locator('[data-testid="byo-domain-input"]').fill('myrealdomain.com')
  await cta.click()
  await page.waitForTimeout(2_500)

  const bodyText = await page.locator('body').innerText()
  const onSignup =
    /Create your account/i.test(bodyText) ||
    (await page.locator('[data-testid="auth-submit"]').count()) > 0
  expect(onSignup, 'anonymous BYO Connect should route to signup').toBe(true)
})
