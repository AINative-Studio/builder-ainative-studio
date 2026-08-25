/**
 * E2E tests for front-door value prop (#65).
 *
 * Both `/` and `/build` render BuildApp (Fork screen) in production.
 * In local dev, `/` may show EnvSetup if env vars are missing — so we test
 * the canonical front door at `/build` which always renders the Fork screen.
 *
 * Validates:
 * 1. /build returns 200.
 * 2. Front door shows the value line with key differentiators.
 * 3. The 3-step ValueStrip is present with correct content per step.
 *
 * Note: uses 'load' + element wait — networkidle times out due to LiveTicker polling.
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Front-door value prop — logged out (#65)', () => {
  test('/build returns 200', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/build`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    expect(response?.status()).toBe(200)
  })

  test('front door shows the value line with key differentiators', async ({ page }) => {
    await page.goto(`${BASE_URL}/build`, { waitUntil: 'load', timeout: 30_000 })

    const valueLine = page.locator('[data-testid="front-door-value-line"]')
    await expect(valueLine).toBeVisible({ timeout: 15_000 })
    const text = await valueLine.textContent()
    // Must name the CTA + differentiators — "own" and "no code"
    expect(text?.toLowerCase()).toMatch(/tell cody/)
    expect(text?.toLowerCase()).toMatch(/own/)
    expect(text?.toLowerCase()).toMatch(/no code/i)
  })

  test('front door shows the 3-step value strip', async ({ page }) => {
    await page.goto(`${BASE_URL}/build`, { waitUntil: 'load', timeout: 30_000 })

    const strip = page.locator('[data-testid="value-strip"]')
    await expect(strip).toBeVisible({ timeout: 15_000 })

    // All three step containers present
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator(`[data-testid="value-step-${i}"]`)).toBeVisible({ timeout: 5_000 })
    }

    // Step 1: idea
    const s1 = await page.locator('[data-testid="value-step-1"]').textContent()
    expect(s1?.toLowerCase()).toContain('idea')

    // Step 2: own
    const s2 = await page.locator('[data-testid="value-step-2"]').textContent()
    expect(s2?.toLowerCase()).toMatch(/own/)

    // Step 3: runs itself (autonomous operation)
    const s3 = await page.locator('[data-testid="value-step-3"]').textContent()
    expect(s3?.toLowerCase()).toMatch(/run/)
  })

  test('front door value strip is accessible — has aria-label', async ({ page }) => {
    await page.goto(`${BASE_URL}/build`, { waitUntil: 'load', timeout: 30_000 })

    const strip = page.locator('[data-testid="value-strip"]')
    await expect(strip).toBeVisible({ timeout: 15_000 })
    const ariaLabel = await strip.getAttribute('aria-label')
    expect(ariaLabel).toBeTruthy()
    expect(ariaLabel?.toLowerCase()).toMatch(/how|step|what/)
  })
})
