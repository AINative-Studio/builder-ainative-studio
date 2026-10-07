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
    // #842: the sticky/height-capped reset moved from .m-live-col-chat
    // itself to the inner .m-live-col-chat-sticky wrapper (see
    // app/modernist.css); the outer column still carries `order: -1`.
    expect(inBlock(900, /\.m-live-col-chat-sticky\s*\{[^}]*position:\s*static/)).toBe(true)
    expect(inBlock(900, /\.m-live-col\.m-live-col-chat\s*\{[^}]*order:\s*-1/)).toBe(true)
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

  it('#940 — dashboard act-bar wraps instead of overflowing at <=760px', () => {
    expect(inBlock(760, /\.m-actbar\s*\{[^}]*flex-wrap:\s*wrap/)).toBe(true)
    expect(inBlock(760, /\.m-acts\s*\{[^}]*flex-wrap:\s*wrap/)).toBe(true)
    expect(inBlock(760, /\.m-actbar-right\s*\{[^}]*flex-wrap:\s*wrap/)).toBe(true)
    expect(inBlock(760, /\.m-actbar-btn\s*\{[^}]*min-height:\s*44px/)).toBe(true)
    expect(inBlock(760, /\.m-land-sound[\s\S]{0,40}\{[^}]*min-height:\s*44px|min-height:\s*44px[\s\S]*\.m-land-sound/)).toBe(true)
  })
})

describe('accessibility fixes (2026-10-05 audit)', () => {
  it('#726e6e is darkened from the original #7d7979 to clear WCAG 1.4.3 (4.5:1) against --color-bg', () => {
    expect(css).toMatch(/--text-muted:\s*#726e6e/)
    expect(css).not.toMatch(/--text-muted:\s*#7d7979/)
  })

  it('.btn-primary uses --color-accent-600 (5.07:1), not base --color-accent (4.20:1, fails 1.4.3)', () => {
    const btnPrimaryBlock = css.match(/\.modernist \.btn-primary\s*\{[^}]*\}/)?.[0] || ''
    expect(btnPrimaryBlock).toMatch(/background:\s*var\(--color-accent-600\)/)
    expect(btnPrimaryBlock).not.toMatch(/background:\s*var\(--color-accent\)[;,\s]/)
  })

  it('.sr-only utility exists for screen-reader-only content', () => {
    expect(css).toMatch(/\.sr-only\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/)
  })

  it('Auth.tsx BrandPanel tagline is no longer a real <h2> preceding the screen\'s real <h1>', () => {
    const authTsx = readFileSync(join(__dirname, '../../components/build/screens/Auth.tsx'), 'utf8')
    // Scope to the real JSX only — BrandPanel's own explanatory comment
    // mentions "<h2>" in prose, which would false-positive a naive match.
    const brandPanelJsx = authTsx.match(/<aside className="m-auth-brand">[\s\S]*?<\/aside>/)?.[0] || ''
    expect(brandPanelJsx).not.toBe('')
    expect(brandPanelJsx).not.toMatch(/<h2[\s>]/)
    expect(brandPanelJsx).toMatch(/<p className="m-artifact m-auth-statement">/)
    // The real screen heading (copy.h, rendered later in the component) stays an <h1>.
    expect(authTsx).toMatch(/<h1 className="m-artifact m-auth-h">\{copy\.h\}<\/h1>/)
  })

  it('Auth.tsx form fields carry real autocomplete/inputmode hints', () => {
    const authTsx = readFileSync(join(__dirname, '../../components/build/screens/Auth.tsx'), 'utf8')
    expect(authTsx).toMatch(/type="email"[^>]*autoComplete="email"/)
    expect(authTsx).toMatch(/autoComplete=\{mode === 'login' \? 'current-password' : 'new-password'\}/)
    expect(authTsx).toMatch(/type="tel"[^>]*autoComplete="tel"/)
    // one-time-code hint lived on the OTP verification-code input, removed
    // #734 follow-up (2026-10-07) alongside the rest of the OTP UI — see
    // Auth-phone-otp.test.tsx's header for why. Restore this assertion
    // alongside that JSX when OTP verification comes back.
  })

  it('Landing.tsx has real nav/main/footer landmarks, not bare divs', () => {
    const landingTsx = readFileSync(join(__dirname, '../../components/build/screens/Landing.tsx'), 'utf8')
    expect(landingTsx).toMatch(/<nav className="m-land-nav"/)
    expect(landingTsx).toMatch(/<main>/)
    expect(landingTsx).toMatch(/<footer className="m-land-foot">/)
    // The old bare-div versions must be gone, not just the new tags added alongside them.
    expect(landingTsx).not.toMatch(/<div className="m-land-nav">/)
    expect(landingTsx).not.toMatch(/<div className="m-land-foot">/)
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
