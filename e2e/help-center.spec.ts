/**
 * E2E tests for /help — AI Help Center (#60)
 *
 * Test gates (from the issue):
 * 1. /help returns HTTP 200 (NOT 307→/login) — middleware allowlist is wired.
 * 2. The "ask anything" box submits and returns an answer (model call MOCKED
 *    via route interception, so the test is deterministic + offline).
 * 3. The FAQ section and Guides card render (SSR).
 * 4. FAQPage JSON-LD is present and valid.
 * 5. /help appears in /sitemap.xml.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('/help — AI Help Center', () => {
  test('returns 200 and is NOT redirected to /login', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/help`)
    // Any 307 means the middleware allowlist is missing — this bug bit /best + /about.
    expect(response.status()).toBe(200)
    expect(response.url()).not.toContain('/login')
  })

  test('renders the "How can we help?" hero and ask box (SSR)', async ({ page }) => {
    await page.goto(`${BASE_URL}/help`)

    await expect(page.getByRole('heading', { name: /How can we help/i })).toBeVisible()

    // The ask box input + submit button.
    const input = page.locator('#help-question')
    await expect(input).toBeVisible()
    await expect(page.getByRole('button', { name: /^Ask$/i })).toBeVisible()
  })

  test('ask box submits and returns an answer (model MOCKED)', async ({ page }) => {
    // Deterministically mock the model backend so the test never hits a real LLM.
    await page.route('**/api/build/help', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'You deploy by starting a subscription; Cody builds the real backend.',
          sources: [{ id: 'how-do-i-deploy', question: 'How do I deploy my app to a live URL?' }],
          provider: 'anthropic',
          model: 'mock',
        }),
      })
    })

    await page.goto(`${BASE_URL}/help`)
    await page.locator('#help-question').fill('how do I deploy my app?')
    await page.getByRole('button', { name: /^Ask$/i }).click()

    // The grounded answer renders.
    const answer = page.locator('[data-agent-role="answer"]')
    await expect(answer).toBeVisible()
    await expect(answer).toContainText(/deploy by starting a subscription/i)
    // The FAQ source citation is shown.
    await expect(answer).toContainText(/How do I deploy my app/i)
  })

  test('renders the FAQ section and Guides card', async ({ page }) => {
    await page.goto(`${BASE_URL}/help`)

    // FAQ heading + at least a few Q/A blocks server-rendered.
    await expect(page.getByRole('heading', { name: /Frequently Asked Questions/i })).toBeVisible()
    const faq = page.locator('#faq')
    await expect(faq).toBeVisible()
    const questions = faq.locator('h4')
    expect(await questions.count()).toBeGreaterThanOrEqual(5)

    // Guides card links to /guides.
    const guidesLink = page.locator('[data-agent-role="guides-link"]')
    await expect(guidesLink).toBeVisible()
    expect(await guidesLink.getAttribute('href')).toBe('/guides')
  })

  test('contains valid FAQPage JSON-LD', async ({ page }) => {
    await page.goto(`${BASE_URL}/help`)

    const ldScripts = await page.locator('script[type="application/ld+json"]').all()
    expect(ldScripts.length).toBeGreaterThanOrEqual(1)

    let foundFaq = false
    for (const script of ldScripts) {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(await script.innerHTML())
      } catch {
        continue
      }
      if (data['@type'] === 'FAQPage') {
        foundFaq = true
        const mainEntity = data.mainEntity as Array<Record<string, unknown>>
        expect(Array.isArray(mainEntity)).toBe(true)
        expect(mainEntity.length).toBeGreaterThanOrEqual(5)
        const q0 = mainEntity[0]
        expect(q0['@type']).toBe('Question')
        expect(typeof q0.name).toBe('string')
        const answer = q0.acceptedAnswer as Record<string, unknown>
        expect(answer['@type']).toBe('Answer')
        expect(typeof answer.text).toBe('string')
      }
    }
    expect(foundFaq).toBe(true)
  })

  test('/help appears in sitemap.xml', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/sitemap.xml`)
    expect([200, 304]).toContain(response.status())
    const body = await response.text()
    expect(body).toContain('/help')
  })

  test('footer nav on /help points to /help', async ({ page }) => {
    await page.goto(`${BASE_URL}/help`)
    const footer = page.locator('footer[data-agent-role="navigation"]')
    await expect(footer).toBeVisible()
    const helpLink = footer.getByRole('link', { name: /^Help$/i })
    await expect(helpLink).toBeVisible()
    expect(await helpLink.getAttribute('href')).toBe('/help')
  })
})
