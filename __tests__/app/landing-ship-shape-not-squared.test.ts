import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Real bug found live (2026-09-15): modernist.css's global flat-editorial
 * reset — `.modernist * { border-radius: 0 !important }` — squares off every
 * rounded shape in the landing page's Cody-beam-down sequence (ship hull,
 * ship glow, ship lights, Cody's shadow pool) and the nav's sound-toggle dot,
 * since a plain (non-!important) border-radius on a more specific selector
 * still loses to a universal-selector !important rule. Confirmed live: the
 * ship's designed oval bottom rendered as a hard square edge, and the sound
 * dot rendered as a square instead of a circle.
 *
 * Each of these is a deliberate, explicit exception to the flat aesthetic —
 * this test pins the source file so a future edit can't silently drop the
 * !important and regress back to a squared-off ship.
 */
describe('Landing page rounded shapes survive the global border-radius reset', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'app/modernist.css'), 'utf8')

  it('the global reset itself exists (sanity — this is what these rules must beat)', () => {
    expect(css).toMatch(/\.modernist \* \{ border-radius: 0 !important; \}/)
  })

  it('ship hull keeps its elliptical oval-bottom radius as !important', () => {
    expect(css).toMatch(/\.m-land-ship-hull \{[^}]*border-radius: 0 0 50% 50% \/ 0 0 100% 100% !important/)
  })

  it('ship glow, ship lights, and Cody\'s shadow pool keep their circular radius as !important', () => {
    expect(css).toMatch(/\.m-land-ship-glow \{[^}]*border-radius: 50% !important/)
    expect(css).toMatch(/\.m-land-ship-light \{[^}]*border-radius: 50% !important/)
    expect(css).toMatch(/\.m-land-cody-pool \{[^}]*border-radius: 50% !important/)
  })

  it('the nav sound-toggle dot keeps its circular radius as !important', () => {
    expect(css).toMatch(/\.m-land-sound-dot \{[^}]*border-radius: 50% !important/)
  })
})
