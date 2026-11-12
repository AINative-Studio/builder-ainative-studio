import { describe, it, expect } from 'vitest'
import { validateJavaScriptCode } from '@/lib/code-validator'

/**
 * Regression for #1904: autoFixCode's RESPONSIVE FLOOR fix (builder#188)
 * guarantees a mobile-first baseline when an app has real layout structure
 * (a grid or horizontal flex) but ZERO real Tailwind breakpoint usage
 * (sm:/md:/lg:/xl:) anywhere. The gate used to scan raw, unmasked code for
 * breakpoint-shaped text, so a comment that merely MENTIONED a breakpoint
 * prefix — not a real class anywhere in the app — made the check think the
 * app already had responsive design and silently skipped the fix, leaving a
 * genuinely non-responsive layout untouched.
 */
describe('RESPONSIVE FLOOR comment-blindness (#1904)', () => {
  it('still applies the mobile-first floor fix when a comment merely mentions sm:/md: but no real breakpoint class exists', () => {
    // Deliberately uses ONLY the text-Nxl heading-scale case (not
    // grid-cols-N/flex-row), since those two are already unconditionally
    // rewritten earlier in autoFixCode by the separate MOBILE GRID/MOBILE
    // FLEX ROW fixes (builder#196) regardless of RESPONSIVE FLOOR's own
    // gate — this isolates the comment-blindness bug in the gate itself.
    const code = [
      'export default function App() {',
      '  // Simple counter app. On larger screens use sm: or md: prefixes if needed.',
      '  return (',
      '    <div>',
      '      <h1 className="text-5xl">Count</h1>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.fixes).toEqual(
      expect.arrayContaining([expect.stringContaining('Added mobile-first responsive classes')]),
    )
    expect(r.code).toContain('text-3xl sm:text-4xl lg:text-5xl')
  })

  it('does NOT apply the floor fix when a REAL breakpoint class is already present', () => {
    const code = [
      'export default function App() {',
      '  return (',
      '    <div className="grid grid-cols-1 sm:grid-cols-3">',
      '      <div className="flex flex-row">Counter</div>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.fixes || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Added mobile-first responsive classes')]),
    )
    // Untouched — already opted into its own responsive design.
    expect(r.code).toContain('grid grid-cols-1 sm:grid-cols-3')
  })

  it('does NOT apply the floor fix when a comment-only "grid"/"flex-row" mention is the only structure (no real layout to fix)', () => {
    const code = [
      'export default function App() {',
      '  // used to render a grid with flex-row items, now simplified',
      '  return <div className="p-4">Hello</div>',
      '}',
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.fixes || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Added mobile-first responsive classes')]),
    )
  })
})
