import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #517 (cont.) — the same rating-requiring schema-type bug found on the root
 * layout also appears independently on 4 more pages, plus one page
 * (/best/[category]) carries a FABRICATED aggregateRating (4.8 stars, 127
 * ratings) with no real review source backing it. We never invent rating
 * data — the fix removes SoftwareApplication/WebApplication in favor of
 * Product (no rating requirement) and deletes the fabricated rating outright
 * rather than trying to "complete" it with a review array.
 */

const FILES = [
  'app/compare/[competitor]/page.tsx',
  'app/best/[category]/page.tsx',
  'app/templates/[slug]/page.tsx',
  'app/build/page.tsx',
  'app/showcase/[slug]/page.tsx',
]

describe.each(FILES)('%s JSON-LD does not use a rating-requiring schema type (SEO audit)', (file) => {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')

  it('does not declare SoftwareApplication/WebApplication/MobileApplication', () => {
    expect(source).not.toMatch(/@type['"]:\s*['"](SoftwareApplication|WebApplication|MobileApplication)['"]/)
  })

  it('does not declare applicationCategory (Product uses category instead)', () => {
    expect(source).not.toMatch(/\bapplicationCategory\s*:/)
  })
})

describe('best/[category] page never fabricates a star rating (SEO audit)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/best/[category]/page.tsx'),
    'utf8'
  )

  it('has no aggregateRating block', () => {
    expect(source).not.toMatch(/aggregateRating/)
  })

  it('has no AggregateRating type', () => {
    expect(source).not.toMatch(/AggregateRating/)
  })
})
