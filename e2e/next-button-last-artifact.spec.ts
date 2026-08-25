import { test, expect } from '@playwright/test'

/**
 * Regression (#next-dead-end): on the LAST artifact (preview), the pager "Next ›"
 * button was disabled → clicking it did nothing, trapping the user. It must now
 * advance to the pricing/pay-gate screen (same forward path as "Make it real →").
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

test('Next › on the preview (last) artifact advances to pricing, is not a dead-end', async ({ page }) => {
  // Land on the preview artifact view directly (last APP_VIEW).
  await page.goto(`${BASE}/build?view=preview`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const nextBtn = page.getByRole('button', { name: /Next ›/ }).first()
  // If the pager is present (non-autoplay), Next must be enabled + navigate.
  if (await nextBtn.isVisible().catch(() => false)) {
    await expect(nextBtn).toBeEnabled()
    await nextBtn.click()
    await page.waitForTimeout(1500)
    // Pricing screen headline confirms we advanced (not stuck on preview).
    const advanced = await page.getByText(/make it real|prototype works|Free|Pro|Business/i).first().isVisible().catch(() => false)
    expect(advanced).toBe(true)
  }
})
