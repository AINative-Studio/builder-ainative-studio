import { describe, it, expect } from 'vitest'
import { DESIGN_SYSTEMS, getDesignSystem } from '@/lib/design-systems/catalog'

/**
 * Design System Picker MVP (#590) — the 6-system catalog. Values here are
 * transcribed from the real theme.json files in the source drop
 * (~/Downloads/Design systems for builder product/systems/<name>/theme.json),
 * except Modernist (from the live app/modernist.css). These tests lock in
 * the real data so a future edit can't silently drift from the source.
 */
describe('DESIGN_SYSTEMS catalog', () => {
  it('includes at least the 6 MVP systems', () => {
    const ids = new Set(DESIGN_SYSTEMS.map((s) => s.id))
    for (const id of ['cody', 'crayon', 'ledger', 'modernist', 'noir', 'outrun']) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('every system has a unique id', () => {
    const ids = DESIGN_SYSTEMS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every non-Modernist system has a real stylesheetPath; Modernist has none (uses app/modernist.css)', () => {
    for (const s of DESIGN_SYSTEMS) {
      if (s.id === 'modernist') {
        expect(s.stylesheetPath).toBeNull()
      } else {
        expect(s.stylesheetPath).toMatch(new RegExp(`^/design-systems/${s.id}/styles\\.css$`))
      }
    }
  })

  it('getDesignSystem resolves a real system by id', () => {
    const cody = getDesignSystem('cody')
    expect(cody).toBeDefined()
    expect(cody!.name).toBe('Cody')
    expect(cody!.primitive).toBe('Cody (CTO agent)')
    expect(cody!.brandBound).toBe(true)
  })

  it('getDesignSystem returns undefined for an unknown id — never fabricates a system', () => {
    expect(getDesignSystem('does-not-exist')).toBeUndefined()
  })

  it('Cody is brand-bound; Ledger is not despite naming a primitive', () => {
    const bound = DESIGN_SYSTEMS.filter((s) => s.brandBound)
    expect(bound.map((s) => s.id)).toContain('cody')
    // Ledger's real theme.json has brandBound: false despite naming a
    // primitive ("AI COGS") — transcribed exactly as the source has it,
    // not "corrected" to what might seem more consistent.
    const ledger = getDesignSystem('ledger')!
    expect(ledger.primitive).toBe('AI COGS')
    expect(ledger.brandBound).toBe(false)
  })

  it('Modernist matches the live app/modernist.css values', () => {
    const modernist = getDesignSystem('modernist')!
    expect(modernist.palette.bg).toBe('#f3f2f2')
    expect(modernist.palette.text).toBe('#201e1d')
    expect(modernist.palette.accent).toBe('#ec3013')
    expect(modernist.fonts.heading.family).toBe('Archivo')
  })

  it('every system defines both heading and body fonts with at least one weight', () => {
    for (const s of DESIGN_SYSTEMS) {
      expect(s.fonts.heading.family.length).toBeGreaterThan(0)
      expect(s.fonts.heading.weights.length).toBeGreaterThan(0)
      expect(s.fonts.body.family.length).toBeGreaterThan(0)
      expect(s.fonts.body.weights.length).toBeGreaterThan(0)
    }
  })

  it('the dark systems (Noir, Cody, Outrun) all have a dark band', () => {
    for (const id of ['noir', 'cody', 'outrun']) {
      expect(getDesignSystem(id)!.palette.band).toBe('dark')
    }
  })

  it('the light systems (Modernist, Crayon, Ledger) all have a light band', () => {
    for (const id of ['modernist', 'crayon', 'ledger']) {
      expect(getDesignSystem(id)!.palette.band).toBe('light')
    }
  })
})
