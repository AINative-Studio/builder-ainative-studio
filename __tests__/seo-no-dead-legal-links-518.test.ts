import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #518 — the Landing footer (components/build/screens/Landing.tsx) links to
 * /terms and /privacy on builder.ainative.studio itself, but neither route
 * exists in this app (no app/terms or app/privacy directory). Anonymous
 * visitors clicking either link fall through middleware's default-deny and
 * get silently redirected to /login instead of a 404 or real content.
 * ainative.studio has real, live pages for both — confirmed 200 live before
 * this fix. Repointed to those instead of building placeholder pages here.
 *
 * /acceptable-use is a separate, still-open finding: no real page exists on
 * EITHER site to link to, so it is intentionally left as-is pending a real
 * content decision rather than guessed at.
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
})
