import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #518/#540 — the Landing footer (components/build/screens/Landing.tsx)
 * links to /terms, /privacy, and /acceptable-use on builder.ainative.studio
 * itself, but none of those routes exist in this app (no app/terms,
 * app/privacy, or app/acceptable-use directory). Anonymous visitors clicking
 * any of them fall through middleware's default-deny and get silently
 * redirected to /login instead of a 404 or real content. ainative.studio has
 * real, live pages for all three — confirmed 200 live before each fix.
 * Repointed to those instead of building placeholder pages here.
 *
 * /acceptable-use was a separate, held-open finding (#540): no real page
 * existed on EITHER site when /terms and /privacy were first fixed. A real
 * page has since been published at ainative.studio/acceptable-use (confirmed
 * live, real policy content) — repointed here to close out #540.
 */
describe('Landing footer legal links point to real, live pages (SEO audit)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Landing.tsx'),
    'utf8'
  )

  it('Terms links to the real ainative.studio page, not the nonexistent local /terms route', () => {
    expect(source).toMatch(/href="https:\/\/ainative\.studio\/terms"/)
  })

  it('Privacy links to the real ainative.studio page, not the nonexistent local /privacy route', () => {
    expect(source).toMatch(/href="https:\/\/ainative\.studio\/privacy"/)
  })

  it('Acceptable use links to the real ainative.studio page, not the nonexistent local /acceptable-use route', () => {
    expect(source).toMatch(/href="https:\/\/ainative\.studio\/acceptable-use"/)
  })
})
