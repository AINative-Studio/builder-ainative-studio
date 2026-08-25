/**
 * E2E tests for /pricing and /billing routes (#76).
 *
 * Validates:
 *  - /pricing returns 200 (not 404 or 307)
 *  - All three plan tiers render (Free, Pro, Business)
 *  - FAQPage JSON-LD is present and valid
 *  - Product/Offer JSON-LD is present
 *  - /pricing is referenced in /sitemap.xml
 *  - /billing redirects (not 404)
 */

import { test, expect } from '@playwright/test'

test.describe('/pricing route', () => {
  test('returns 200 — not a 404 or auth redirect', async ({ page }) => {
    const response = await page.goto('/pricing')
    expect(response?.status()).toBe(200)
    // Must NOT have been redirected to /login
    expect(page.url()).not.toContain('/login')
    expect(page.url()).toContain('/pricing')
  })

  test('renders all three plan tier cards', async ({ page }) => {
    await page.goto('/pricing')

    await expect(page.getByTestId('tier-free')).toBeVisible()
    await expect(page.getByTestId('tier-pro')).toBeVisible()
    await expect(page.getByTestId('tier-business')).toBeVisible()
  })

  test('shows correct prices for each tier', async ({ page }) => {
    await page.goto('/pricing')

    // Free tier shows "Free" text
    const freePriceEl = page.getByTestId('price-free')
    await expect(freePriceEl).toContainText('Free')

    // Pro tier shows $49
    const proPriceEl = page.getByTestId('price-pro')
    await expect(proPriceEl).toContainText('49')

    // Business tier shows $199
    const bizPriceEl = page.getByTestId('price-business')
    await expect(bizPriceEl).toContainText('199')
  })

  test('CTA buttons link to /build', async ({ page }) => {
    await page.goto('/pricing')

    const ctaFree = page.getByTestId('cta-free')
    await expect(ctaFree).toHaveAttribute('href', '/build')

    const ctaPro = page.getByTestId('cta-pro')
    await expect(ctaPro).toHaveAttribute('href', '/build')

    const ctaBiz = page.getByTestId('cta-business')
    await expect(ctaBiz).toHaveAttribute('href', '/build')
  })

  test('FAQPage JSON-LD is present and has correct @type', async ({ page }) => {
    await page.goto('/pricing')

    const scripts = await page.$$eval(
      'script[type="application/ld+json"]',
      (els) => els.map((el) => el.textContent ?? ''),
    )

    const faqScript = scripts.find((s) => {
      try {
        return JSON.parse(s)['@type'] === 'FAQPage'
      } catch {
        return false
      }
    })

    expect(faqScript).toBeDefined()

    const faqData = JSON.parse(faqScript!)
    expect(faqData['@context']).toBe('https://schema.org')
    expect(Array.isArray(faqData.mainEntity)).toBe(true)
    expect(faqData.mainEntity.length).toBeGreaterThan(0)

    // Each entry must be a Question with an acceptedAnswer
    for (const entity of faqData.mainEntity) {
      expect(entity['@type']).toBe('Question')
      expect(entity.name).toBeTruthy()
      expect(entity.acceptedAnswer?.['@type']).toBe('Answer')
      expect(entity.acceptedAnswer?.text).toBeTruthy()
    }
  })

  test('Product/Offer JSON-LD is present with pricing offers', async ({ page }) => {
    await page.goto('/pricing')

    const scripts = await page.$$eval(
      'script[type="application/ld+json"]',
      (els) => els.map((el) => el.textContent ?? ''),
    )

    const productScript = scripts.find((s) => {
      try {
        return JSON.parse(s)['@type'] === 'Product'
      } catch {
        return false
      }
    })

    expect(productScript).toBeDefined()

    const productData = JSON.parse(productScript!)
    expect(productData['@context']).toBe('https://schema.org')
    expect(productData.name).toBeTruthy()
    expect(Array.isArray(productData.offers)).toBe(true)
    expect(productData.offers.length).toBeGreaterThanOrEqual(2)

    // Validate the Pro offer has price 49
    const proOffer = productData.offers.find((o: { name: string }) => o.name === 'Pro')
    expect(proOffer).toBeDefined()
    expect(proOffer.price).toBe('49')
    expect(proOffer.priceCurrency).toBe('USD')
  })

  test('/pricing is referenced in /sitemap.xml', async ({ page }) => {
    const response = await page.goto('/sitemap.xml')
    expect(response?.status()).toBe(200)

    const body = await page.content()
    expect(body).toContain('/pricing')
  })
})

test.describe('/billing route', () => {
  test('redirects — does not return 404', async ({ page }) => {
    const response = await page.goto('/billing')
    // Should redirect to /build (possibly with query string)
    expect(response?.status()).not.toBe(404)
    expect(page.url()).not.toContain('/billing')
    // Must land on /build
    expect(page.url()).toContain('/build')
  })
})
