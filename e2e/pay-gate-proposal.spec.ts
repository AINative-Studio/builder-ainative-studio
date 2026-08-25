import { test, expect } from '@playwright/test'

/**
 * Pay-gate designed proposal (#68) — the #1 conversion lever.
 *
 * The founder pays when they SEE a good design AND what Cody is proposing:
 * the real app preview + the business systems Cody wires (each with "what it
 * does" + click-to-preview) + a clear cost line, framed mid-journey.
 *
 * These specs assert the Pricing (Launch) screen renders that concrete proposal
 * and every interaction works, WITHOUT starting a real Stripe checkout.
 * Deep-links via ?screen=pricing&company=riff (no slow codegen).
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Pay-gate designed proposal (#68)', () => {
  test('renders the proposal: app preview + systems + cost, mid-journey framing', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=pricing&company=riff`, { waitUntil: 'domcontentloaded' })

    // The whole proposal surface is present.
    const gate = page.getByTestId('proposal-gate')
    await expect(gate).toBeVisible({ timeout: 30000 })

    // 1. Mid-journey framing — "you've already started", not cold-sold.
    const headline = page.getByTestId('proposal-headline')
    await expect(headline).toBeVisible()
    await expect(headline).toContainText(/what Cody builds next/i)

    // 2. The real, already-generated app preview panel (iframe or graceful fallback).
    const appFrame = page.getByTestId('proposal-app-frame')
    const appFallback = page.getByTestId('proposal-app-fallback')
    await expect(appFrame.or(appFallback).first()).toBeVisible({ timeout: 15000 })

    // 3. The business systems Cody wires — at least one, each with what-it-does copy.
    const systems = page.getByTestId('proposal-systems').locator('[data-testid^="proposal-system-"]')
    await expect(systems.first()).toBeVisible()
    expect(await systems.count()).toBeGreaterThan(0)
    await expect(systems.first().locator('.m-proposal-sys-does')).not.toBeEmpty()

    // 4. Live-vs-planned framing line (#67 reuse) is present.
    await expect(page.getByTestId('proposal-framing-line')).toBeVisible()

    // 5. A clear cost line tying the proposal to the plan.
    const cost = page.getByTestId('proposal-cost')
    await expect(cost).toBeVisible()
    await expect(cost).toContainText(/\$\d+\/mo/)

    // 6. The real pricing tiers + CTA are still present below the proposal.
    await expect(page.getByTestId('choose-pro')).toBeVisible()
    await expect(page.getByTestId('tier-business')).toBeVisible()
  })

  test('each proposed system is click-to-preview (in-context preview updates)', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=pricing&company=riff`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('proposal-gate')).toBeVisible({ timeout: 30000 })

    // A preview panel renders by default (first system open — never a blank).
    const previewTitle = page.getByTestId('proposal-preview-title')
    await expect(previewTitle).toBeVisible()
    const firstTitle = (await previewTitle.textContent())?.trim() || ''
    expect(firstTitle.length).toBeGreaterThan(0)

    // The preview shows a concrete representative table.
    await expect(page.getByTestId('proposal-preview-table')).toBeVisible()
    expect(await page.getByTestId('proposal-preview-table').locator('tbody tr').count()).toBeGreaterThan(0)

    // Click through EVERY proposed system and verify its preview renders in context.
    const systems = page.getByTestId('proposal-systems').locator('[data-testid^="proposal-system-"]')
    const n = await systems.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      const row = systems.nth(i)
      await row.click()
      // The clicked row is marked open (aria-expanded) and the preview table stays present.
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByTestId('proposal-preview-table')).toBeVisible()
      // The preview title reflects the selected system's name.
      const name = (await row.locator('.m-system-name').textContent())?.trim() || ''
      if (name) await expect(previewTitle).toContainText(name)
    }
  })

  test('does not start checkout until a tier CTA is clicked (proposal is presentation only)', async ({ page }) => {
    // The proposal must NOT auto-fire the checkout endpoint — only the tier CTA does.
    let checkoutCalled = false
    await page.route('**/api/build/checkout', async (route) => {
      checkoutCalled = true
      // Fulfill with a blanked URL so the browser never navigates to Stripe.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '' }) })
    })

    await page.goto(`${BASE}/build?screen=pricing&company=riff`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('proposal-gate')).toBeVisible({ timeout: 30000 })

    // Interact with the proposal (click a system preview) — checkout must NOT fire.
    const systems = page.getByTestId('proposal-systems').locator('[data-testid^="proposal-system-"]')
    await systems.first().click()
    await page.waitForTimeout(500)
    expect(checkoutCalled).toBe(false)

    // Now the tier CTA DOES route to checkout — the proposal leads into the real pay path.
    await page.getByTestId('choose-pro').click()
    await expect.poll(() => checkoutCalled, { timeout: 15000 }).toBe(true)
  })
})
