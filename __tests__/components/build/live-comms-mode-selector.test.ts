import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #743 — Live.tsx's comms-mode selector ("Agile standup" / "Pair
 * programming"). Live.tsx is a large, deeply-hooked component with no
 * existing render-harness convention (see live-idea-hydration.test.ts) — this
 * repo's established pattern for this file is source-text assertions on the
 * real compiled behavior, not a mounted render. Kept consistent with that.
 */
describe('Live screen — comms-mode selector (#743)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('hydrates the persisted commsMode from /api/build/resolve-app', () => {
    const idx = source.indexOf('Hydrate the persisted comms-mode selection')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 800)
    expect(nearby).toMatch(/\/api\/build\/resolve-app\?slug=/)
    expect(nearby).toMatch(/d\.commsMode/)
    expect(nearby).toMatch(/setCommsMode/)
  })

  it('defaults commsMode state to agile', () => {
    expect(source).toMatch(/useState<'agile' \| 'pairProgramming'>\('agile'\)/)
  })

  it('changeCommsMode posts to /api/build/comms-mode with the slug and mode', () => {
    const idx = source.indexOf('const changeCommsMode = async')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 800)
    expect(nearby).toMatch(/\/api\/build\/comms-mode/)
    expect(nearby).toMatch(/method: 'POST'/)
    expect(nearby).toMatch(/slug: companyId/)
  })

  it('changeCommsMode requires sign-in and reverts optimistic state on failure', () => {
    const idx = source.indexOf('const changeCommsMode = async')
    const nearby = source.slice(idx, idx + 800)
    expect(nearby).toMatch(/if \(!signedIn/)
    expect(nearby).toMatch(/setCommsMode\(previous\)/)
  })

  it('renders a real, persisted 2-option selector bound to commsMode', () => {
    const idx = source.indexOf('data-testid="comms-mode-selector"')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 700)
    expect(nearby).toMatch(/value=\{commsMode\}/)
    expect(nearby).toMatch(/onChange=\{\(ev\) => changeCommsMode/)
    expect(nearby).toContain('Agile standup')
    expect(nearby).toContain('Pair programming')
    expect(nearby).toMatch(/<option value="agile">/)
    expect(nearby).toMatch(/<option value="pairProgramming">/)
  })

  it('disables the selector while unsigned-in or a save is in flight', () => {
    const idx = source.indexOf('data-testid="comms-mode-selector"')
    const nearby = source.slice(idx, idx + 700)
    expect(nearby).toMatch(/disabled=\{!signedIn \|\| commsModeSaving\}/)
  })
})
