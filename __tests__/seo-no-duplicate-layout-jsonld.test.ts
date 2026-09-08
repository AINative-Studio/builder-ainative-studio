import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * 2026-09-07 — app/layout.tsx used to inject a global Product/WebSite/
 * Organization JSON-LD block into <head> on EVERY route, including pages
 * that already define their own (correct) JSON-LD. On /pricing this meant
 * two conflicting Product schemas with two different Business-tier prices
 * ($149 stale in layout vs. $199 real, per lib/build/pricing-tiers.ts) —
 * live-verified via curl before this fix. A structured-data validator
 * hitting every one of the ~50 sitemap URLs, each carrying this one bad
 * duplicated block, is the most likely real root cause of the technical
 * SEO audit's "444 invalid structured data items" finding (see
 * docs/growth/TECHNICAL_SEO_AUDIT_2026-09-06.md).
 *
 * Fix: the global block was deleted outright. Each route keeps (or gets)
 * its own page-level JSON-LD instead. This test locks in that the global
 * injection point in the root layout stays gone.
 */
describe('root layout does not inject global JSON-LD (SEO audit)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/layout.tsx'), 'utf8')

  it('has no application/ld+json script in the root layout', () => {
    expect(source).not.toMatch(/application\/ld\+json/)
  })

  it('does not hand-maintain a separate stale Business-tier price', () => {
    // The real Business tier is $199/mo (lib/build/pricing-tiers.ts). The
    // deleted block had it at $149 — guard against a stale price sneaking
    // back into this file specifically.
    expect(source).not.toMatch(/'149'/)
  })

  it('canonical does not point at an unrelated domain', () => {
    expect(source).not.toMatch(/live\.ainative\.studio/)
  })
})

describe('homepage carries its own Product JSON-LD matching the real pricing tiers', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/page.tsx'), 'utf8')

  it('declares a Product schema', () => {
    expect(source).toMatch(/@type['"]:\s*['"]Product['"]/)
  })

  it('prices the AggregateOffer at the real $0–$199 range, not a stale figure', () => {
    expect(source).toMatch(/highPrice:\s*['"]199['"]/)
    expect(source).not.toMatch(/highPrice:\s*['"]149['"]/)
    expect(source).not.toMatch(/highPrice:\s*['"]699['"]/)
  })
})
