import { describe, it, expect } from 'vitest'
import {
  THEMES,
  selectTheme,
  formatThemeForPrompt,
  applyThemeToPrompt,
  themeFromDesignSystem,
  formatDesignSystemExtras,
  googleFontsUrl,
} from '@/lib/theme-system'
import { DESIGN_SYSTEMS, getDesignSystem } from '@/lib/design-systems/catalog'

describe('selectTheme (pre-existing, must stay unchanged — #592 must never break this)', () => {
  it('keyword-matches health ideas to the Corti HealthTech theme', () => {
    expect(selectTheme('a healthcare clinic scheduling app').id).toBe('corti-healthtech')
  })

  it('is deterministic for the same idea text', () => {
    const idea = 'a totally generic idea with no keywords'
    expect(selectTheme(idea).id).toBe(selectTheme(idea).id)
  })

  it('always returns a real theme from THEMES', () => {
    const t = selectTheme('some random idea')
    expect(THEMES.map((x) => x.id)).toContain(t.id)
  })
})

describe('themeFromDesignSystem (#592)', () => {
  it('maps a real DesignSystem onto the ThemePalette shape', () => {
    const cody = getDesignSystem('cody')!
    const theme = themeFromDesignSystem(cody)
    expect(theme.id).toBe('cody')
    expect(theme.name).toBe('Cody')
    expect(theme.primary).toBe('#7dd3fc')   // system's accent
    expect(theme.dark).toBe('#0b1220')      // system's bg
    expect(theme.light).toBe('#111827')     // system's surface
    expect(theme.secondary).toBe('#f59e0b') // system's accent2
    expect(theme.neutral).toBe('#e5e7eb')   // system's text
  })

  it('produces a valid, different (darker) hex for primaryHover', () => {
    const noir = getDesignSystem('noir')!
    const theme = themeFromDesignSystem(noir)
    expect(theme.primaryHover).toMatch(/^#[0-9a-f]{6}$/)
    expect(theme.primaryHover).not.toBe(theme.primary)
  })

  it('maps every one of the 6 MVP systems without throwing', () => {
    for (const sys of DESIGN_SYSTEMS) {
      expect(() => themeFromDesignSystem(sys)).not.toThrow()
    }
  })

  it('formatThemeForPrompt accepts a design-system-derived theme (same real function, no special-casing needed)', () => {
    const theme = themeFromDesignSystem(getDesignSystem('outrun')!)
    const prompt = formatThemeForPrompt(theme)
    expect(prompt).toContain('OUTRUN')
    expect(prompt).toContain('#ff2fa0')
  })

  it('applyThemeToPrompt replaces THEME_* placeholders with the design system colors', () => {
    const theme = themeFromDesignSystem(getDesignSystem('ledger')!)
    const result = applyThemeToPrompt('bg-[THEME_PRIMARY] text-[THEME_DARK]', theme)
    expect(result).toBe('bg-[#1f6f43] text-[#fbfaf6]')
  })
})

describe('formatDesignSystemExtras (#592)', () => {
  it('states the real heading and body font names', () => {
    const cody = getDesignSystem('cody')!
    const extras = formatDesignSystemExtras(cody)
    expect(extras).toContain('Geist Mono')
    expect(extras).toContain('Geist')
  })

  it('states the real corner radius', () => {
    const crayon = getDesignSystem('crayon')!
    expect(formatDesignSystemExtras(crayon)).toContain('16px')
  })

  it('tells the model to use NO shadows for a shadows:none system', () => {
    const noir = getDesignSystem('noir')!
    expect(noir.shadows).toBe('none')
    expect(formatDesignSystemExtras(noir).toLowerCase()).toContain('no box-shadows')
  })

  it('tells the model to use glow shadows for a shadows:glow system', () => {
    const outrun = getDesignSystem('outrun')!
    expect(outrun.shadows).toBe('glow')
    expect(formatDesignSystemExtras(outrun).toLowerCase()).toContain('glow')
  })

  it('never crashes for any of the 6 MVP systems', () => {
    for (const sys of DESIGN_SYSTEMS) {
      expect(() => formatDesignSystemExtras(sys)).not.toThrow()
    }
  })
})

describe('googleFontsUrl (#593) — real, live-verified against fonts.googleapis.com', () => {
  it('Noir: builds the exact URL confirmed live (200) against Google Fonts', () => {
    const url = googleFontsUrl(getDesignSystem('noir')!)
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=Cormorant:wght@300;400;500&family=Jost:wght@300;400;500&display=swap',
    )
  })

  it('Crayon: builds the exact URL confirmed live (200) against Google Fonts', () => {
    const url = googleFontsUrl(getDesignSystem('crayon')!)
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Nunito:wght@400;600;700&display=swap',
    )
  })

  it('Cody: builds the exact URL confirmed live (200) against Google Fonts', () => {
    const url = googleFontsUrl(getDesignSystem('cody')!)
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@500;700&family=Geist:wght@400;500;600&display=swap',
    )
  })

  it('Outrun: builds the exact URL confirmed live (200) against Google Fonts', () => {
    const url = googleFontsUrl(getDesignSystem('outrun')!)
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Exo+2:wght@400;500;600&display=swap',
    )
  })

  it('Ledger: builds the exact URL confirmed live (200) against Google Fonts', () => {
    const url = googleFontsUrl(getDesignSystem('ledger')!)
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    )
  })

  it('Modernist: heading and body share a family — no duplicate &family= param', () => {
    const url = googleFontsUrl(getDesignSystem('modernist')!)
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap',
    )
    expect(url.match(/family=/g)?.length).toBe(1)
  })

  it('every generated URL is well-formed https:// pointing at fonts.googleapis.com', () => {
    for (const sys of DESIGN_SYSTEMS) {
      const url = googleFontsUrl(sys)
      expect(url).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/)
      expect(url).toContain('&display=swap')
    }
  })
})

describe('formatDesignSystemExtras — includes the exact <link> tag (#593)', () => {
  it('embeds a real, pasteable <link> tag with the correct href', () => {
    const cody = getDesignSystem('cody')!
    const extras = formatDesignSystemExtras(cody)
    expect(extras).toContain(`<link rel="stylesheet" href="${googleFontsUrl(cody)}">`)
  })
})
