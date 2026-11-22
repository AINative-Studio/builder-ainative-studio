import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #2218 — AX "Machine-Readable Content" gap: the checker also credits a
 * <link type="application/rss+xml"> tag in <head> as a redundant signal for
 * the same real feed (app/feed.xml/route.ts). Next.js renders this from
 * `metadata.alternates.types` — read directly off the source file (same
 * approach as seo-no-duplicate-layout-jsonld.test.ts) rather than importing
 * the Server Component module, which pulls in React/Next runtime concerns a
 * plain unit test shouldn't need.
 */
describe('app/layout.tsx — RSS feed alternate link (#2218)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/layout.tsx'), 'utf-8')

  it('declares the real feed.xml URL under alternates.types', () => {
    expect(source).toMatch(/alternates:\s*{[\s\S]*?types:\s*{\s*['"]application\/rss\+xml['"]:\s*['"]https:\/\/builder\.ainative\.studio\/feed\.xml['"]/)
  })
})
