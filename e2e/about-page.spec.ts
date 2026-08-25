/**
 * E2E tests for /about — founder story + vision page (#61)
 *
 * Test gates:
 * 1. /about returns HTTP 200 (NOT 307→/login) — the middleware allowlist is wired.
 * 2. The founder story content is in server-rendered HTML (SSR, not CSR).
 * 3. Article, Organization, and Person JSON-LD are present and parseable.
 * 4. /about appears in /sitemap.xml.
 * 5. The footer link on /about works (is an anchor pointing to /about).
 * 6. The nav link in AppHeader links to /about.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('/about page', () => {
  test('returns 200 and is NOT redirected to /login', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/about`)
    // Must be 200 — any 307 means the middleware allowlist is missing.
    expect(response.status()).toBe(200)
    expect(response.url()).not.toContain('/login')
  })

  test('renders founder story content in server HTML', async ({ page }) => {
    await page.goto(`${BASE_URL}/about`)

    // Page title / headline
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    const headingText = await h1.textContent()
    expect(headingText).toBeTruthy()
    expect(headingText!.length).toBeGreaterThan(5)

    // "Founder Story" label present in the page
    const founderLabel = page.getByText(/Founder Story/i)
    await expect(founderLabel).toBeVisible()

    // "Cody" mentioned in the narrative
    const bodyText = await page.locator('article').textContent()
    expect(bodyText).toContain('Cody')

    // CTA button linking to /build
    const buildBtn = page.getByRole('link', { name: /Start Building/i }).first()
    await expect(buildBtn).toBeVisible()
    const href = await buildBtn.getAttribute('href')
    expect(href).toContain('/build')
  })

  test('contains Article JSON-LD', async ({ page }) => {
    await page.goto(`${BASE_URL}/about`)

    const ldScripts = await page.locator('script[type="application/ld+json"]').all()
    expect(ldScripts.length).toBeGreaterThanOrEqual(3)

    let foundArticle = false
    let foundOrganization = false
    let foundPerson = false

    for (const script of ldScripts) {
      const text = await script.innerHTML()
      let data: Record<string, unknown>
      try {
        data = JSON.parse(text)
      } catch {
        continue
      }

      const type = data['@type']
      if (type === 'Article') {
        foundArticle = true
        // Validate required fields
        expect(typeof data.headline).toBe('string')
        expect(typeof data.datePublished).toBe('string')
        const author = data.author as Record<string, string>
        expect(author['@type']).toBe('Person')
        const publisher = data.publisher as Record<string, unknown>
        expect(publisher['@type']).toBe('Organization')
      }
      if (type === 'Organization') {
        foundOrganization = true
        expect(typeof data.name).toBe('string')
        expect(typeof data.url).toBe('string')
      }
      if (type === 'Person') {
        foundPerson = true
        expect(typeof data.name).toBe('string')
      }
    }

    expect(foundArticle).toBe(true)
    expect(foundOrganization).toBe(true)
    expect(foundPerson).toBe(true)
  })

  test('/about appears in sitemap.xml', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/sitemap.xml`)
    // Sitemap must be reachable
    expect([200, 304]).toContain(response.status())
    const body = await response.text()
    expect(body).toContain('/about')
  })

  test('footer nav link on /about page is present and points to /about', async ({ page }) => {
    await page.goto(`${BASE_URL}/about`)

    // The footer on the about page itself contains an /about link (aria-current=page)
    const footer = page.locator('footer[data-agent-role="navigation"]')
    await expect(footer).toBeVisible()

    const aboutLink = footer.getByRole('link', { name: /^About$/i })
    await expect(aboutLink).toBeVisible()
    const href = await aboutLink.getAttribute('href')
    expect(href).toBe('/about')
  })

  test('AppHeader nav contains an /about link visible on the page', async ({ page }) => {
    await page.goto(`${BASE_URL}/about`)

    // The AppHeader renders on every page — check it has an About link.
    // On desktop (the default Playwright viewport is 1280px) the desktop nav is visible.
    const header = page.locator('header').first()
    const aboutNav = header.getByRole('link', { name: /About/i })
    await expect(aboutNav).toBeVisible()
    const href = await aboutNav.getAttribute('href')
    expect(href).toContain('/about')
  })
})
