import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * #334–#339 — mobile responsiveness regression guard.
 *
 * The 2026-08-27 audit found modernist.css had effectively no sub-tablet
 * strategy: .m-auth / .m-tiers / .m-fork-cards / .m-account never collapsed
 * (login rendered 516px wide on a 375px phone). These tests pin the phone
 * breakpoints so a future edit can't silently drop them again. They parse the
 * stylesheet text (no browser), asserting each collapse rule lives inside the
 * expected max-width block.
 */

const css = readFileSync(join(__dirname, '../../app/modernist.css'), 'utf8')

/** Return the body of every `@media (max-width: <px>px)` block in the sheet. */
function mediaBlocks(px: number): string[] {
  const out: string[] = []
  const re = new RegExp(`@media \\(max-width: ${px}px\\)\\s*\\{`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    // Walk braces to the matching close of this @media block.
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    out.push(css.slice(start, i - 1))
  }
  return out
}

function inBlock(px: number, pattern: RegExp): boolean {
  return mediaBlocks(px).some((b) => pattern.test(b))
}

describe('modernist.css phone breakpoints (#334–#339)', () => {
  it('#334 — .m-auth stacks to a single column at <=760px', () => {
    expect(inBlock(760, /\.m-auth\s*\{[^}]*grid-template-columns:\s*1fr\b/)).toBe(true)
    expect(inBlock(760, /\.m-auth-brand\s*\{[^}]*padding:/)).toBe(true)
    expect(inBlock(760, /\.m-auth-form\s*\{[^}]*padding:/)).toBe(true)
    expect(inBlock(760, /\.m-auth-statement\s*\{[^}]*font-size:\s*26px/)).toBe(true)
  })

  it('#335 — .m-tiers stacks and .m-pricing padding shrinks at <=760px', () => {
    expect(inBlock(760, /\.m-tiers\s*\{[^}]*grid-template-columns:\s*1fr\b/)).toBe(true)
    expect(inBlock(760, /\.m-pricing\s*\{[^}]*padding:\s*32px 20px/)).toBe(true)
    expect(inBlock(760, /\.m-billing-switch button\s*\{[^}]*min-height:\s*44px/)).toBe(true)
  })

  it('#336 — workspace + Live grids collapse via a real media query, not only .is-tablet', () => {
    expect(inBlock(900, /\.m-ws-body\s*\{[^}]*grid-template-columns:\s*1fr\b/)).toBe(true)
    expect(inBlock(900, /\.m-live-grid\s*\{[^}]*grid-template-columns:\s*1fr\b/)).toBe(true)
    expect(inBlock(900, /\.m-live-col\.m-live-col-chat\s*\{[^}]*position:\s*static[^}]*order:\s*-1/)).toBe(true)
    // The .is-tablet JS path stays for compat (build-context matchMedia dispatch).
    expect(css).toMatch(/\.m-ws-body\.is-tablet\s*\{\s*grid-template-columns:\s*1fr/)
    expect(css).toMatch(/\.m-live-grid\.is-tablet\s*\{\s*grid-template-columns:\s*1fr/)
  })

  it('#337 — fork cards + landing beat 2 stack at <=700px', () => {
    expect(inBlock(700, /\.m-fork-cards\s*\{[^}]*grid-template-columns:\s*1fr\b/)).toBe(true)
    expect(inBlock(700, /\.m-fork,\s*\.m-intake\s*\{[^}]*padding-inline:\s*20px/)).toBe(true)
    expect(inBlock(700, /\.m-land-beat2-grid\s*\{[^}]*grid-template-columns:\s*1fr\b/)).toBe(true)
    // Desktop base rule exists (moved out of the Landing.tsx inline style).
    expect(css).toMatch(/\.m-land-beat2-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/)
  })

  it('#338 — account head wraps and padding shrinks at <=600px', () => {
    expect(inBlock(600, /\.m-account\s*\{[^}]*padding:\s*24px 16px/)).toBe(true)
    expect(inBlock(600, /\.m-account-head\s*\{[^}]*flex-wrap:\s*wrap/)).toBe(true)
  })

  it('#339 — 44px tap floor + legibility bumps at <=760px only (desktop untouched)', () => {
    expect(
      inBlock(760, /\.btn-ghost[\s\S]*?\.m-back[\s\S]*?\.m-land-signin[\s\S]*?\.m-account-chip\s*\{[^}]*min-height:\s*44px/),
    ).toBe(true)
    expect(inBlock(760, /\.m-land-foot a\s*\{[^}]*min-height:\s*44px/)).toBe(true)
    expect(inBlock(760, /\.m-field-l\s*\{\s*font-size:\s*12px/)).toBe(true)
    expect(inBlock(760, /\.m-helper\s*\{\s*font-size:\s*14px/)).toBe(true)
    // Desktop base sizes stay as designed (10px label, 11px helper).
    expect(css).toMatch(/^\.m-field-l\s*\{\s*font-size:\s*10px/m)
    expect(css).toMatch(/^\.m-helper\s*\{[^}]*font-size:\s*11px/m)
  })

  it('Landing.tsx no longer hard-codes the beat-2 grid inline', () => {
    const tsx = readFileSync(join(__dirname, '../../components/build/screens/Landing.tsx'), 'utf8')
    expect(tsx).not.toMatch(/gridTemplateColumns:\s*'1fr 1fr'/)
    expect(tsx).toMatch(/m-land-beat2-grid/)
    expect(tsx).toMatch(/m-land-beat2-photo/)
  })
})

describe('4-tier pricing grids never orphan the 4th card (2026-09-15)', () => {
  /**
   * Real bug found live on /pricing: both .m-tiers (workspace Pricing.tsx,
   * 4 real tiers) and the public page's own grid used a column count that
   * didn't match the real 4-item list (3 columns, or `auto-fit` which
   * resolved to 3 at common widths) — the 4th tier wrapped alone onto a new
   * row with empty grid cells beside it.
   */
  it('.m-tiers uses exactly 4 base columns (matches TIERS.length in Pricing.tsx)', () => {
    expect(css).toMatch(/\.m-tiers\s*\{\s*grid-template-columns:\s*repeat\(4,/)
  })

  it('.m-tiers-responsive (public /pricing page) also uses exactly 4 base columns', () => {
    expect(css).toMatch(/\.m-tiers-responsive\s*\{\s*grid-template-columns:\s*repeat\(4,/)
  })

  it('both tier grids collapse to 2 columns at tablet width and 1 at phone width', () => {
    expect(inBlock(760, /\.m-tiers\s*\{[^}]*grid-template-columns:\s*1fr\b/)).toBe(true)
    // `[\s\S]` instead of `.`+`s` flag — this repo's ts target doesn't support `s`.
    expect(css).toMatch(/@media \(max-width: 900px\) and \(min-width: 761px\)\s*\{[\s\S]*?\.m-tiers\s*\{[^}]*grid-template-columns:\s*repeat\(2,/)
    expect(css).toMatch(/@media \(max-width: 900px\) and \(min-width: 761px\)\s*\{[\s\S]*?\.m-tiers-responsive\s*\{[^}]*grid-template-columns:\s*repeat\(2,/)
    expect(css).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*?\.m-tiers-responsive\s*\{[^}]*grid-template-columns:\s*1fr\b/)
  })

  it('the app/pricing page uses the fixed-column class, not the old auto-fit grid', () => {
    const tsx = readFileSync(join(__dirname, '../../app/pricing/page.tsx'), 'utf8')
    expect(tsx).not.toMatch(/repeat\(auto-fit/)
    expect(tsx).toMatch(/m-tiers-responsive/)
  })
})

describe('PublicNav does not overflow at phone widths (2026-09-15)', () => {
  /**
   * Real bug found live: PublicNav (about/pricing/compare/guides/help/etc.)
   * packs the brand block + up to 4 links + sign-in into one unwrapping flex
   * row. The landing page's own nav never hit this (only 2 actions), but
   * PublicNav's extra links overflowed the viewport at 390px.
   */
  it('.m-land-nav-actions wraps instead of overflowing', () => {
    expect(css).toMatch(/\.m-land-nav-actions\s*\{[^}]*flex-wrap:\s*wrap/)
  })

  it('the "by AINative" sublabel is hidden at phone width to make room', () => {
    expect(inBlock(760, /\.m-land-brand-by\s*\{[^}]*display:\s*none/)).toBe(true)
  })

  it('the nav row itself gets tighter padding at phone width', () => {
    expect(inBlock(760, /\.m-land-nav\s*\{[^}]*padding:\s*14px 16px/)).toBe(true)
  })
})
