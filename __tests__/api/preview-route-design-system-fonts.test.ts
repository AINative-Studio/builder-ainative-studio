import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Design System Picker (#593) — found via a real end-to-end production test:
 * a single-file generated App.tsx correctly referenced a chosen design
 * system's real fonts (fontFamily: "'Orbitron', sans-serif") but the font was
 * never actually LOADED — the preview route's static HTML wrapper
 * (app/api/preview/[id]/route.ts) always hardcoded Inter+Poppins regardless
 * of what was generated, because a single-file component has no <head> of
 * its own to inject a <link> into. This looks up the chosen system (stored
 * alongside the generation via preview-store's designSystemId) and loads
 * ITS real Google Fonts instead.
 */
describe('preview [id] route loads the chosen design system\'s real fonts (2026-09-09 bugfix)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/preview/[id]/route.ts'),
    'utf8',
  )

  it('looks up the chosen system from the stored chat data, not a client-supplied value', () => {
    expect(source).toMatch(/getDesignSystem\(getChatData\(id\)\?\.designSystemId/)
  })

  it('builds the font link from the real googleFontsUrl helper, not a hand-written string', () => {
    expect(source).toMatch(/googleFontsUrl\(chosenPreviewSystem\)/)
  })

  it('falls back to the original Inter+Poppins link when no system was chosen', () => {
    expect(source).toContain(
      'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&display=swap',
    )
  })

  it('the Tailwind font-sans config also uses the chosen system\'s body font', () => {
    expect(source).toMatch(/chosenPreviewSystem\.fonts\.body\.family/)
  })
})

/**
 * Real bug (customer-reported, 2026-09-09, Ledra): the chosen design system
 * ("Ledger") DID reach the model's own generated component correctly (real
 * Libre Franklin/JetBrains Mono fonts, real #1f6f43 accent, rounded-[0px] —
 * confirmed via a deep analysis of the real generated output), but the
 * static preview-shell HTML around it disagreed on two counts:
 *   (a) the plain CSS `body { font-family: ... }` rule was a pure literal
 *       ('Inter', 'Poppins', ...), unconditional, contradicting the
 *       correctly-design-system-aware <link> tag and Tailwind
 *       fontFamily.sans config two/three lines away in the SAME template.
 *   (b) the Tailwind `colors` block (brand-primary/dark-1/2/3) was ALSO a
 *       pure literal with no chosenPreviewSystem branch at all — any
 *       generated class like bg-brand-primary rendered AINative's generic
 *       purple/navy regardless of which system was chosen.
 * Both are now derived from the same real palette data (chosenPreviewSystem)
 * used everywhere else in this file, with the original literals kept only
 * as the no-system-chosen fallback.
 *
 * A FIRST attempt at fixing (b) shipped a second, subtler bug that evaded
 * both tsc and the full test suite: `colors: chosenPreviewSystem ? {...} : {...}`
 * was written directly into the tailwind.config template literal WITHOUT a
 * `${...}` wrapper. That whole block is literal browser-side JS *source text*
 * embedded in a <script> tag — a bare ternary there is not evaluated, it's
 * emitted verbatim, so real served pages contained the literal broken string
 * "colors: chosenPreviewSystem ? {" (confirmed live via a real generation +
 * curl of the served HTML). The earlier version of this test only checked
 * for that substring's PRESENCE, which passed whether or not it was actually
 * wrapped in ${} — a real gap in test coverage that let a real bug ship
 * undetected. Fixed by computing the value server-side into
 * `previewColorsJson` (a plain JSON.stringify'd object) and interpolating it
 * with ${}, exactly like the adjacent, already-correct fontFamily.sans line.
 * These tests now assert on the ${} wrapper itself, not just nearby text.
 */
describe('preview [id] route: body CSS font-family and Tailwind colors also honor the chosen system (2026-09-09 bugfix)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/preview/[id]/route.ts'),
    'utf8',
  )

  it('the plain CSS body rule is conditional on chosenPreviewSystem, not a bare literal', () => {
    const bodyRuleIdx = source.indexOf("body { margin: 0; font-family:")
    expect(bodyRuleIdx).toBeGreaterThan(-1)
    const nearby = source.slice(bodyRuleIdx, bodyRuleIdx + 300)
    expect(nearby).toMatch(/chosenPreviewSystem/)
    expect(nearby).toMatch(/chosenPreviewSystem\.fonts\.body\.family/)
  })

  it('falls back to the original Inter/Poppins body font when no system was chosen', () => {
    expect(source).toMatch(/'Inter', 'Poppins', system-ui, sans-serif/)
  })

  it('the Tailwind colors value is computed server-side and interpolated with ${}, not left as a bare in-template ternary', () => {
    // The regression: this exact substring, unwrapped, is what shipped broken.
    expect(source).not.toContain('colors: chosenPreviewSystem ? {')
    // The fix: colors resolves through a real ${...} interpolation slot.
    expect(source).toMatch(/colors:\s*\$\{previewColorsJson\}/)
  })

  it('previewColorsJson is derived from the real chosen palette via JSON.stringify, with the original literal fallback', () => {
    const defIdx = source.indexOf('const previewColorsJson')
    expect(defIdx).toBeGreaterThan(-1)
    const nearby = source.slice(defIdx, defIdx + 500)
    expect(nearby).toMatch(/chosenPreviewSystem\.palette\.accent/)
    expect(nearby).toMatch(/chosenPreviewSystem\.palette\.bg/)
    expect(nearby).toMatch(/chosenPreviewSystem\.palette\.surface/)
    expect(nearby).toMatch(/JSON\.stringify/)
  })

  it('falls back to the original hardcoded brand colors when no system was chosen', () => {
    expect(source).toContain("'brand-primary': '#5867EF'")
    expect(source).toContain("'dark-1': '#131726'")
  })
})
