import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * 2026-09-07 — /capabilities is a real, public, high-value page (#313/#316,
 * "the #1 customer ask") that had zero JSON-LD at all, found via the AEO gap
 * analysis. Added ItemList (enumerating the real included primitives) +
 * FAQPage (from the natural "can I build X" questions the page already
 * answers per-capability) — no fabricated ratings, matching the #517
 * Product-not-WebApplication precedent.
 */
describe('/capabilities carries real JSON-LD (SEO/AEO audit)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/capabilities/page.tsx'), 'utf8')

  it('declares an ItemList schema', () => {
    expect(source).toMatch(/@type['"]:\s*['"]ItemList['"]/)
  })

  it('declares a FAQPage schema', () => {
    expect(source).toMatch(/@type['"]:\s*['"]FAQPage['"]/)
  })

  it('does not use a rating-requiring schema type', () => {
    expect(source).not.toMatch(/@type['"]:\s*['"](WebApplication|SoftwareApplication|MobileApplication)['"]/)
  })

  it('never fabricates aggregateRating or review data', () => {
    expect(source).not.toMatch(/aggregateRating/)
    expect(source).not.toMatch(/['"]review['"]\s*:/)
  })

  it('sets a canonical URL', () => {
    expect(source).toMatch(/canonical:\s*PAGE_URL/)
  })
})
