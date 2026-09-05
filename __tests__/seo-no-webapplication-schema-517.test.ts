import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #517 — the root layout's global JSON-LD (app/layout.tsx, the `jsonLd`
 * const injected on every page) declared `@type: 'WebApplication'` with an
 * `offers`/AggregateOffer block but no `aggregateRating` or `review`. Per
 * Google's structured-data guidelines, SoftwareApplication/WebApplication/
 * MobileApplication require one of those two fields to be rich-results
 * eligible — without it the markup is invalid.
 *
 * Same bug already fixed site-wide on ainative-website (#2139): converted to
 * `Product`, which carries no rating requirement, rather than fabricating a
 * rating that doesn't exist.
 */
describe('root layout JSON-LD does not use a rating-requiring schema type without a rating (SEO audit)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/layout.tsx'), 'utf8')

  it('does not declare WebApplication/SoftwareApplication/MobileApplication', () => {
    expect(source).not.toMatch(/@type['"]:\s*['"](WebApplication|SoftwareApplication|MobileApplication)['"]/)
  })

  it('uses Product for the app/offer listing instead', () => {
    expect(source).toMatch(/@type['"]:\s*['"]Product['"]/)
  })

  it('never fabricates aggregateRating or review data', () => {
    expect(source).not.toMatch(/aggregateRating/)
    expect(source).not.toMatch(/['"]review['"]\s*:/)
  })
})
