import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real gap (customer-reported, Meridian, 2026-09-10): Live.tsx's one call to
 * /api/build/company-app (the Company track's real generated landing-page
 * app) never sent designSystemId at all, even though state.designSystemId
 * was already available on the same state object — the Company track simply
 * never visited the Design step to populate it in the first place (fixed
 * separately in lib/build/state.ts's PICK_TRACK). This asserts the request
 * body actually includes it now, mirroring the App track's chat-ws calls.
 */
describe('Live screen — company-app request forwards the chosen design system', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('the /api/build/company-app fetch body includes designSystemId from state', () => {
    const idx = source.indexOf("fetch('/api/build/company-app'")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 900)
    expect(nearby).toMatch(/designSystemId:\s*state\.designSystemId/)
  })
})
