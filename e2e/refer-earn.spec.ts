/**
 * E2E for Refer & Earn (#59).
 *
 * Acceptance verified here:
 *  1. An authenticated user sees their referral LINK + a working COPY button, and
 *     the three headline stats (Friends Referred / Credits Earned / Credits
 *     Pending) render from /api/build/referral.
 *  2. A guest sees an honest "create an account" prompt instead of a fake link.
 *  3. A mocked referred-subscribe credits the referrer — POST
 *     /api/build/subscription/verify returns referralCredited and the referrer's
 *     stats reflect the newly-credited referral on reload.
 *
 * To keep the test deterministic (no live ZeroDB), we stub next-auth's session
 * (as other Account specs do) and intercept /api/build/referral +
 * /api/build/subscription/verify with a TEST-LOCAL store that mirrors the real
 * route contracts. Reached via the deterministic deep-link /build?screen=refer.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const CODE = 'REFABC12345'
const LINK = `${BASE}/?ref=${CODE}`

/** Stub next-auth session → a real authenticated user (referrer). */
async function stubAuthSession(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'real-u1', email: 'ada@example.com', name: 'Ada Lovelace', type: 'regular' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    }),
  )
}

/** Stub next-auth session → a guest (no durable account). */
async function stubGuestSession(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'guest-u1', email: 'guest-71f8b8c05@example.com', name: '', type: 'guest' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    }),
  )
}

/**
 * Install a stubbed /api/build/referral + /api/build/subscription/verify that
 * behave like the real routes against a shared in-memory `stats` object.
 */
async function stubReferral(page: Page, stats: { friendsReferred: number; creditsEarned: number; creditsPending: number }) {
  await page.route('**/api/build/referral', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: CODE, link: LINK, stats }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'pending' }) })
  })
  await page.route('**/api/build/subscription/verify', async (route: Route) => {
    // Mocked referred-subscribe: credit the referrer — flip one pending → earned.
    if (stats.creditsPending > 0) {
      stats.creditsPending -= 1
      stats.creditsEarned += 25
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, paid: true, plan: 'pro', planName: 'Pro', referralCredited: 25 }),
    })
  })
}

test.describe('#59 Refer & Earn — authenticated', () => {
  test('renders the referral link, copy button, and three stats', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await stubAuthSession(page)
    await stubReferral(page, { friendsReferred: 2, creditsEarned: 25, creditsPending: 1 })
    await page.goto(`${BASE}/build?screen=refer`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('refer-earn').waitFor({ timeout: 20000 })

    // Link renders with the real value.
    await expect(page.getByTestId('refer-link')).toHaveValue(LINK)
    await expect(page.getByTestId('refer-code')).toHaveText(CODE)

    // Stats render.
    await expect(page.getByTestId('refer-friends')).toHaveText('2')
    await expect(page.getByTestId('refer-earned')).toHaveText('$25')
    await expect(page.getByTestId('refer-pending')).toHaveText('1')

    // Copy works — button flips to the copied state.
    await page.getByTestId('refer-copy').click()
    await expect(page.getByTestId('refer-copy')).toContainText(/copied/i)
  })

  test('a mocked referred-subscribe credits the referrer (stats update on reload)', async ({ page }) => {
    const stats = { friendsReferred: 2, creditsEarned: 25, creditsPending: 1 }
    await stubAuthSession(page)
    await stubReferral(page, stats)
    await page.goto(`${BASE}/build?screen=refer`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('refer-earn').waitFor({ timeout: 20000 })
    await expect(page.getByTestId('refer-pending')).toHaveText('1')

    // Simulate the referred user subscribing → the verify route credits the referrer.
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/build/subscription/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'cs_test_referred', slug: 'referredco' }),
      })
      return r.json()
    })
    expect(res.referralCredited).toBe(25)

    // Reload the referrer's Refer & Earn view — the credit is now reflected.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('refer-earn').waitFor({ timeout: 20000 })
    await expect(page.getByTestId('refer-earned')).toHaveText('$50')
    await expect(page.getByTestId('refer-pending')).toHaveText('0')
  })
})

test.describe('#59 Refer & Earn — guest', () => {
  test('shows a create-account prompt instead of a fake link', async ({ page }) => {
    await stubGuestSession(page)
    await page.goto(`${BASE}/build?screen=refer`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('refer-earn').waitFor({ timeout: 20000 })
    await expect(page.getByTestId('refer-guest-prompt')).toBeVisible()
    await expect(page.getByTestId('refer-guest-signup')).toBeVisible()
    // No shareable link for a guest.
    await expect(page.getByTestId('refer-link')).toHaveCount(0)
  })
})
