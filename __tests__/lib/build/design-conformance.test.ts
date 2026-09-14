import { describe, it, expect } from 'vitest'
import {
  checkDesignConformance,
  extractColorsFromCode,
  paletteColorsToCheck,
} from '@/lib/build/design-conformance'
import { getDesignSystem, DESIGN_SYSTEMS } from '@/lib/design-systems/catalog'

/**
 * Design system conformance checker (#751).
 *
 * The real gap this issue exists to close: TODAY there is zero check that a
 * generated app actually used its founder's chosen design system's colors —
 * any output "passes" because nothing looks. These tests prove the checker
 * can genuinely tell the difference between conformant and non-conformant
 * generated code, using Outrun ("Neo-retro 80s" — accent #ff2fa0 hot pink,
 * accent2 #2ee6ff cyan, bg #140a2b) precisely because it's a distinctive,
 * memorable palette, not a generic blue that could coincidentally appear.
 */
describe('checkDesignConformance', () => {
  const outrun = getDesignSystem('outrun')!

  it('real fixture — CONFORMANT generated HTML/CSS is classified as pass', () => {
    // Realistic generated output: a Tailwind arbitrary-value hero + inline
    // style block, exactly the shape chat-ws's own prompt instructs
    // (`bg-[${theme.primary}]`, `text-[${theme.accent}]`) — using Outrun's
    // REAL accent/accent2/bg colors throughout, the way a model that actually
    // obeyed the injected palette would.
    const conformantCode = `
      <main aria-label="Nightdrive - synthwave playlist app">
        <section className="bg-[#140a2b] text-[#fbeaff]">
          <h1 className="text-[#ff2fa0]">Nightdrive</h1>
          <button className="bg-[#ff2fa0] hover:bg-[#e0007e] text-white shadow-[0_0_24px_#ff2fa055]">
            Get Started
          </button>
          <div className="bg-[#1e1040] border border-[#2ee6ff]/20">
            <span className="text-[#2ee6ff]">Now Playing</span>
          </div>
        </section>
        <style>
          .badge { background: #ff2fa0; color: #2ee6ff; }
        </style>
      </main>
    `

    const result = checkDesignConformance(outrun, conformantCode)

    expect(result.status).toBe('pass')
    expect(result.matchedColors).toContain('#ff2fa0')
    expect(result.matchedColors).toContain('#2ee6ff')
    expect(result.matchedColors).toContain('#140a2b')
    expect(result.score).toBeGreaterThanOrEqual(0.5)
    expect(result.summary).toMatch(/PASS/)
  })

  it('real fixture — NON-CONFORMANT generated HTML/CSS (wrong palette) is classified as fail', () => {
    // Realistic generated output that ignored Outrun entirely and improvised
    // a completely different, generic blue/gray palette instead — the exact
    // failure mode this issue tracks (model given a distinctive palette,
    // produced its own defaults instead).
    const nonConformantCode = `
      <main aria-label="Nightdrive - synthwave playlist app">
        <section className="bg-white text-slate-900">
          <h1 className="text-blue-600">Nightdrive</h1>
          <button className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-lg">
            Get Started
          </button>
          <div className="bg-gray-100 border border-gray-200">
            <span className="text-indigo-500">Now Playing</span>
          </div>
        </section>
        <style>
          .badge { background: #3b82f6; color: #64748b; }
        </style>
      </main>
    `

    const result = checkDesignConformance(outrun, nonConformantCode)

    expect(result.status).toBe('fail')
    expect(result.matchedColors).toHaveLength(0)
    expect(result.score).toBe(0)
    expect(result.summary).toMatch(/FAIL/)
    expect(result.summary).toContain('Outrun')
  })

  it('real fixture — PARTIAL conformance when only some palette colors appear', () => {
    // Uses the real accent color but none of the other Outrun palette colors —
    // the model partially obeyed (grabbed the primary CTA color) but didn't
    // commit to the whole system (background/surface stayed generic).
    const partialCode = `
      <main aria-label="Nightdrive">
        <section className="bg-white text-slate-900">
          <button className="bg-[#ff2fa0] text-white">Get Started</button>
        </section>
      </main>
    `

    const result = checkDesignConformance(outrun, partialCode)

    expect(result.status).toBe('partial')
    expect(result.matchedColors).toEqual(['#ff2fa0'])
    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(0.5)
    expect(result.summary).toMatch(/PARTIAL/)
  })

  it('is case-insensitive and normalizes 3-digit hex shorthand', () => {
    const code = `<div style="background: #FF2FA0;"></div><span class="text-[#2ee6ff]"></span>`
    const result = checkDesignConformance(outrun, code)
    expect(result.matchedColors).toContain('#ff2fa0')
  })

  it('matches rgb()/rgba() color literals against the hex palette', () => {
    // 255, 47, 160 == #ff2fa0 (Outrun's accent)
    const code = `<div style="background: rgb(255, 47, 160);"></div>`
    const result = checkDesignConformance(outrun, code)
    expect(result.matchedColors).toContain('#ff2fa0')
    expect(result.status).not.toBe('fail')
  })

  it('handles empty/whitespace-only generated code without throwing', () => {
    const result = checkDesignConformance(outrun, '')
    expect(result.status).toBe('fail')
    expect(result.matchedColors).toHaveLength(0)
  })

  it('never returns pass for empty code even with a real design system', () => {
    for (const system of DESIGN_SYSTEMS.slice(0, 5)) {
      const result = checkDesignConformance(system, '<div>no colors here at all</div>')
      expect(result.status).toBe('fail')
    }
  })
})

describe('extractColorsFromCode', () => {
  it('extracts distinct hex colors, deduplicated and normalized', () => {
    const code = `#FF0000 #ff0000 #F00 rgb(0, 255, 0) rgba(0, 0, 255, 0.5)`
    const colors = extractColorsFromCode(code)
    expect(colors.has('#ff0000')).toBe(true)
    expect(colors.has('#00ff00')).toBe(true)
    expect(colors.has('#0000ff')).toBe(true)
    // #FF0000 and #ff0000 and #F00 all collapse to one entry
    expect(Array.from(colors).filter((c) => c === '#ff0000')).toHaveLength(1)
  })

  it('strips alpha channel from 8-digit hex before comparing', () => {
    const colors = extractColorsFromCode('#ff2fa055')
    expect(colors.has('#ff2fa0')).toBe(true)
  })

  it('returns an empty set for code with no colors', () => {
    expect(extractColorsFromCode('<div>hello</div>').size).toBe(0)
  })
})

describe('paletteColorsToCheck', () => {
  it('returns the deduplicated, normalized accent/accent2/bg/surface colors', () => {
    const outrun = getDesignSystem('outrun')!
    const colors = paletteColorsToCheck(outrun.palette)
    expect(colors).toContain('#ff2fa0')
    expect(colors).toContain('#2ee6ff')
    expect(colors).toContain('#140a2b')
    expect(colors).toContain('#1e1040')
    expect(new Set(colors).size).toBe(colors.length)
  })
})
