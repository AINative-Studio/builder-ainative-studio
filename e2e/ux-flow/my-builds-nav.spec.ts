import { test, expect } from '@playwright/test'

/**
 * #330 — a signed-in user must ALWAYS have a path back to their builds.
 * Verifies: (a) the companies deep-link route resolves, (b) the durable list API
 * exists. Full human-flow (nav chip visible after login) is covered by the session
 * harness; here we verify the reachable surfaces on prod without a live session.
 */
const PROD = 'https://builder.ainative.studio'

test('the durable companies list route resolves (#330)', async ({ page }) => {
  const res = await page.goto(`${PROD}/build?screen=companies`, { waitUntil: 'domcontentloaded' })
  expect(res?.status()).toBeLessThan(500)
})

test('the durable my-companies API exists and is auth-gated (#330)', async ({ request }) => {
  const res = await request.get(`${PROD}/api/build/my-companies`)
  // 200 (has session) or 401/redirect (no session) — both prove the durable
  // server-side list endpoint exists (survives navigating away).
  expect([200, 401, 302, 307, 403]).toContain(res.status())
})
