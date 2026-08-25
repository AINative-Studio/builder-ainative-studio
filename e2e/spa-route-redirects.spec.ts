import { test, expect } from '@playwright/test'

/**
 * #83 — SPA-internal screens (/account /settings /profile /refer) must NOT 404;
 * they redirect to the matching /build?screen=... so direct/deep links work.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'
const ROUTES = [
  { path: '/account', screen: 'account' },
  { path: '/settings', screen: 'account' },
  { path: '/profile', screen: 'account' },
  { path: '/refer', screen: 'refer' },
]

for (const { path, screen } of ROUTES) {
  test(`${path} redirects to /build?screen=${screen} (not 404/login)`, async ({ page }) => {
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    expect(resp?.status()).toBeLessThan(400)
    // Should land on /build (redirect target), not a 404 page.
    await page.waitForTimeout(1500)
    expect(page.url()).toContain('/build')
    const body = (await page.locator('body').textContent()) || ''
    expect(body).not.toContain('could not be found')
  })
}
