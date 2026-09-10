import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real gap (customer-reported, Meridian, 2026-09-10, issue #620): the ONE
 * real app a Company-track build got was always company-app's marketing
 * landing page — never the founder's ACTUAL product. Live.tsx now also
 * calls /api/build/company-product (primitive compliance fully enforced,
 * unlike the landing page) and surfaces a distinct, honestly-labeled card
 * so the founder never confuses "landing page is live" with "my real idea
 * is implemented."
 */
describe('Live screen — real product card and company-product wiring (2026-09-10, #620)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('calls /api/build/company-product when productChatId is not yet set', () => {
    const idx = source.indexOf("fetch('/api/build/company-product'")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx - 200, idx + 500)
    expect(nearby).toMatch(/!state\.productChatId/)
  })

  it('the company-product fetch body includes the idea, slug, name, and designSystemId', () => {
    const idx = source.indexOf("fetch('/api/build/company-product'")
    const nearby = source.slice(idx, idx + 400)
    expect(nearby).toMatch(/idea:\s*state\.idea/)
    expect(nearby).toMatch(/slug:\s*state\.appSub/)
    expect(nearby).toMatch(/designSystemId:\s*state\.designSystemId/)
  })

  it('dispatches SET_PRODUCT_CHATID on a successful response', () => {
    const idx = source.indexOf("fetch('/api/build/company-product'")
    const nearby = source.slice(idx, idx + 1200)
    expect(nearby).toMatch(/SET_PRODUCT_CHATID/)
  })

  /**
   * Real bug found live: with primitive compliance enforced, a genuine
   * product generation can trigger chat-ws's own obedience-repair pass (a
   * second model call), pushing wall-clock past the 280s/300s server-side
   * ceiling on a slow attempt — confirmed live (502 "terminated" on 2 of 3
   * real Meridian product-build attempts). Retries transient failures
   * (502/503/504) with backoff instead of silently giving up after one try.
   */
  it('retries transient failures (502/503/504) instead of giving up after one attempt', () => {
    const idx = source.indexOf('attemptProductBuild')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 1000)
    expect(nearby).toMatch(/502/)
    expect(nearby).toMatch(/504/)
    expect(nearby).toMatch(/503/)
    expect(nearby).toMatch(/MAX_PRODUCT_ATTEMPTS/)
  })

  it('renders a distinct "Your product" card, separate from the landing page link', () => {
    expect(source).toMatch(/data-testid="product-card"/)
    expect(source).toMatch(/Your product/)
  })

  it('the product card links to a slug distinct from the landing page ({appSub}-product)', () => {
    const idx = source.indexOf('data-testid="product-live-link"')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 200)
    expect(nearby).toMatch(/\$\{state\.appSub\}-product/)
  })
})
