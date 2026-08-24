import { test, expect } from '@playwright/test'

const PROMPTS = [
  { label: 'Agent Dashboard', btn: 'Agent Dashboard' },
  { label: 'AI Chat Interface', btn: 'AI Chat Interface' },
  { label: 'SaaS Platform', btn: 'SaaS Platform' },
  { label: 'Swarm Monitor', btn: 'Swarm Monitor' },
  { label: 'E-commerce Store', btn: 'E-commerce Store' },
  { label: 'Admin Panel', btn: 'Admin Panel' },
  { label: 'Analytics Dashboard', btn: 'Analytics Dashboard' },
  { label: 'AI Safety Dashboard', btn: 'AI Safety Dashboard' },
]

for (const { label, btn } of PROMPTS) {
  test(`Homepage: "${label}" generates successfully`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('https://builder.ainative.studio', { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(2000)

    // Click the suggestion button
    const button = page.getByText(btn, { exact: true }).first()
    await expect(button).toBeVisible({ timeout: 5_000 })
    await button.click()

    // Wait for generation to complete
    await page.waitForTimeout(5_000)
    try {
      await page.waitForSelector('iframe', { timeout: 120_000 })
    } catch {}
    await page.waitForTimeout(5_000)

    // Verify preview exists
    const content = await page.content()
    const hasPreview = content.includes('/preview/')
    const hasIframe = (await page.locator('iframe').count()) > 0

    console.log(`[${label}] preview=${hasPreview} iframe=${hasIframe}`)
    expect(hasPreview || hasIframe).toBe(true)
  })
}
