/**
 * E2E tests for front-door value prop (#65).
 *
 * Validates:
 * 1. Logged-out homepage (/) shows the value line + enough prose to understand Builder.
 * 2. /build front door (Fork screen) shows the value line + 3-step strip before auth.
 * 3. Both pages return HTTP 200.
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Front-door value prop — logged out (#65)', () => {
  test('homepage returns 200 and shows the hero value line', async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    expect(response?.status()).toBe(200)

    // Hero headline should mention the plain value proposition
    const h1 = page.locator('h1').first()
    await expect(h1).toBeVisible({ timeout: 10_000 })
    const h1Text = await h1.textContent()
    // Must contain the Cody call-to-action and ownership language
    expect(h1Text?.toLowerCase()).toMatch(/tell cody|cody your idea/)
    expect(h1Text?.toLowerCase()).toMatch(/own|no code/)
  })

  test('homepage hero sub-text reinforces no-code + ownership', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const sub = page.locator('[data-testid="homepage-hero-sub"]')
    await expect(sub).toBeVisible({ timeout: 10_000 })
    const subText = await sub.textContent()
    expect(subText?.toLowerCase()).toMatch(/no code/)
    expect(subText?.toLowerCase()).toMatch(/own/)
  })

  test('/build returns 200', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/build`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    expect(response?.status()).toBe(200)
  })

  test('/build fork screen shows the front-door value line', async ({ page }) => {
    await page.goto(`${BASE_URL}/build`, { waitUntil: 'networkidle', timeout: 30_000 })

    const valueLine = page.locator('[data-testid="front-door-value-line"]')
    await expect(valueLine).toBeVisible({ timeout: 10_000 })
    const text = await valueLine.textContent()
    // Must contain the key differentiators
    expect(text?.toLowerCase()).toMatch(/tell cody/)
    expect(text?.toLowerCase()).toMatch(/own/)
    expect(text?.toLowerCase()).toMatch(/no code/i)
  })

  test('/build fork screen shows the 3-step value strip', async ({ page }) => {
    await page.goto(`${BASE_URL}/build`, { waitUntil: 'networkidle', timeout: 30_000 })

    const strip = page.locator('[data-testid="value-strip"]')
    await expect(strip).toBeVisible({ timeout: 10_000 })

    // All three steps should be present
    const step1 = page.locator('[data-testid="value-step-1"]')
    const step2 = page.locator('[data-testid="value-step-2"]')
    const step3 = page.locator('[data-testid="value-step-3"]')

    await expect(step1).toBeVisible({ timeout: 5_000 })
    await expect(step2).toBeVisible({ timeout: 5_000 })
    await expect(step3).toBeVisible({ timeout: 5_000 })

    // Step 1 mentions "idea"
    const step1Text = await step1.textContent()
    expect(step1Text?.toLowerCase()).toContain('idea')

    // Step 2 mentions ownership
    const step2Text = await step2.textContent()
    expect(step2Text?.toLowerCase()).toMatch(/own/)

    // Step 3 conveys autonomous operation
    const step3Text = await step3.textContent()
    expect(step3Text?.toLowerCase()).toMatch(/run/)
  })
})
