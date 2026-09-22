import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real, live production regression (2026-09-21): every generated preview
 * using TypeScript syntax (type annotations, `as` casts — i.e. essentially
 * every real Cody-generated app) started rendering completely blank, with
 * no visible error to the founder. Root-caused by actually downloading and
 * running the exact same @babel/standalone build these preview pages pull
 * from unpkg (unpinned — always "latest") against a real generated app's
 * source: `Babel.transform(src, {presets:[...'typescript'], ...})` with no
 * `filename` option throws
 *   "[BABEL] unknown file: Preset ... requires a filename to be set"
 * on the current @babel/standalone@7.29.9, where older versions compiled
 * fine without one. Confirmed live: adding `filename: 'app.tsx'` to the
 * exact same call compiles successfully.
 *
 * Fixed two ways, both load-bearing: (1) an explicit `filename` on every
 * Babel.transform call in a preview HTML shell, and (2) pinning the CDN
 * script tag to the known-good version instead of always-latest, so an
 * unrelated future Babel release can't silently reintroduce this exact
 * class of platform-wide, fail-silent breakage again.
 */
describe('preview HTML shells set filename on Babel.transform + pin @babel/standalone (2026-09-21 regression)', () => {
  const previewRouteSource = fs.readFileSync(
    path.join(process.cwd(), 'app/api/preview/[id]/route.ts'),
    'utf8',
  )
  const showcaseClientSource = fs.readFileSync(
    path.join(process.cwd(), 'app/showcase/showcase-client.tsx'),
    'utf8',
  )

  it('app/api/preview/[id]/route.ts: Babel.transform sets filename (the real fix)', () => {
    const idx = previewRouteSource.indexOf('Babel.transform(_src,')
    expect(idx).toBeGreaterThan(-1)
    const call = previewRouteSource.slice(idx, idx + 200)
    expect(call).toMatch(/filename:\s*['"][\w./-]+\.tsx?['"]/)
  })

  it('app/api/preview/[id]/route.ts: @babel/standalone CDN script is pinned, not always-latest', () => {
    expect(previewRouteSource).toMatch(/unpkg\.com\/@babel\/standalone@\d+\.\d+\.\d+\/babel\.min\.js/)
    // The exact unpinned form that caused this regression must be gone.
    expect(previewRouteSource).not.toContain('https://unpkg.com/@babel/standalone/babel.min.js')
  })

  it('app/showcase/showcase-client.tsx: Babel.transform sets filename (the real fix)', () => {
    const idx = showcaseClientSource.indexOf('Babel.transform(_src,')
    expect(idx).toBeGreaterThan(-1)
    const call = showcaseClientSource.slice(idx, idx + 200)
    expect(call).toMatch(/filename:\s*['"][\w./-]+\.tsx?['"]/)
  })

  it('app/showcase/showcase-client.tsx: @babel/standalone CDN script is pinned, not always-latest', () => {
    expect(showcaseClientSource).toMatch(/unpkg\.com\/@babel\/standalone@\d+\.\d+\.\d+\/babel\.min\.js/)
    expect(showcaseClientSource).not.toContain('https://unpkg.com/@babel/standalone/babel.min.js')
  })
})
