import { describe, it, expect } from 'vitest'
import { hasFakeButtonGap, hasDynamicTailwindClassGap } from '@/lib/build/obedience-gate'
import { findUndeclaredJsxComponents } from '@/lib/build/completeness-gate'
import { hasGradients, stripGradients } from '@/lib/gradient-blocker'
import { findUnwiredDuplicateSidebar } from '@/lib/build/output-validator'
import { dedupeProvidedComponents } from '@/lib/build/dedupe-provided-components'

/**
 * #2034/#2053/#2055/#2057/#2059/#2061/#2063/.../#2085-class bug: four MORE
 * call sites that scanned forward from a `"`/`'` for the next same-quote
 * character to close a "string literal," with no guard against a
 * contraction apostrophe ("don't", "owner's") or a quote whose only
 * candidate close sits on a later line — neither of which is a real string
 * open in valid JS. Unlike every previously-fixed site, these four called
 * the shared `lib/build/bracket-scanner.ts`'s raw `findStringEnd` directly
 * instead of its already-guarded `resolveStringOpen` wrapper (added by
 * #2053/#2055's fix to `findMatchingBracket`/`maskComments`), so they never
 * picked up that fix for free and kept the original bug independently:
 *
 *  - lib/build/obedience-gate.ts: `findTagClose` (silently returns "tag
 *    unterminated," skipping a real no-op-CTA/AX check entirely) and
 *    `hasDynamicTailwindClassGap`'s own inline scan (skips straight to the
 *    end of the masked code, missing a real glued-interpolation className
 *    class entirely).
 *  - lib/build/completeness-gate.ts: `linesInsideMultilineConstruct` (jumps
 *    to EOF on the first unmatched quote, so a REAL later `/* ... *\/`
 *    block's `// --- FILE:`-shaped text inside it is never marked hidden —
 *    `splitMarkerBlob` then splits on that decoy, separating a component's
 *    real declaration from its usage into different files).
 *  - lib/gradient-blocker.ts: `forEachLiteralContent`/`classNameValueSpans`
 *    (a contraction apostrophe pairs with some unrelated LATER single quote
 *    as a bogus "close," then resumes scanning past the real target string
 *    entirely — a real gradient class inside it is never visited, so
 *    `stripGradients` fails to strip it).
 *  - lib/build/output-validator.ts: `findTagClose` (same shape as
 *    obedience-gate's — a sidebar tag with a malformed apostrophe in an
 *    attribute value is dropped from `findSidebarTags` entirely, so a real
 *    unwired duplicate sidebar is never flagged).
 *  - lib/build/dedupe-provided-components.ts: `isInsideStringLiteral`
 *    (#2085 — an unrelated EARLIER decade-apostrophe with no later same-
 *    line close makes a real, actionable hint-comment match look "inside a
 *    string," so the trailing scaffold text it should have truncated is
 *    left in the generated app).
 *
 * #2085 itself ruled out output-validator.ts's `findTagClose` and
 * gradient-blocker.ts's `forEachLiteralContent` as false positives ("every
 * quote is a genuine attribute-value delimiter, never prose text" / "low/no
 * realistic apostrophe-in-prose exposure"). Both tests below are a
 * confirmed, verified-live correction of that: a single-quoted attribute
 * value whose own text contains an apostrophe is exactly a quote-delimited
 * value with prose inside it — precisely the shape these fixes guard.
 *
 * Each fix here switches the call site to `resolveStringOpen` (the
 * already-reviewed, already-tested shared guard), rather than re-inventing
 * the guard locally — consolidating onto the one fixed implementation
 * instead of adding yet another independent copy of it.
 */
describe('obedience-gate findTagClose apostrophe guard (#2085-class)', () => {
  it('still flags a real no-op CTA button whose attrs contain a malformed single-quoted apostrophe', () => {
    const code = `
      function Hero() {
        return <button title='Store owner's favorite'>Buy Now</button>
      }
    `
    expect(hasFakeButtonGap(code)).toBe(true)
  })
})

describe('obedience-gate hasDynamicTailwindClassGap apostrophe guard (#2085-class)', () => {
  it('still flags a real glued dynamic Tailwind class after a malformed single-quoted apostrophe in the same expression', () => {
    const code =
      "function Hero({ isActive, color }) {\n" +
      "  return <div className={cn('flex', isActive && 'it's live', `bg-${color}-500`)}>x</div>\n" +
      '}'
    expect(hasDynamicTailwindClassGap(code)).toBe(true)
  })
})

describe('completeness-gate linesInsideMultilineConstruct apostrophe guard (#2085-class)', () => {
  it('does not let a JSX-text apostrophe hide a real block comment, so a decoy "// --- FILE:" line inside it is never mistaken for a real file boundary', () => {
    const blob = [
      '// --- FILE: /App.tsx ---',
      'function Badge() { return <span>Badge</span> }',
      "function Note() { return <p>Visitor's favorite section</p> }",
      '/*',
      '// --- FILE: /Decoy.tsx ---',
      '*/',
      'export default function App() { return <div><Badge /><Note /></div> }',
    ].join('\n')
    expect(findUndeclaredJsxComponents(blob)).toEqual([])
  })
})

describe('gradient-blocker forEachLiteralContent/classNameValueSpans apostrophe guard (#2085-class)', () => {
  it('still strips a real gradient class that sits after a malformed contraction apostrophe in the same className expression', () => {
    const code =
      '<div className={cn("flex", isActive && don\'t_show, ' +
      "'bg-gradient-to-r from-pink-500 to-yellow-500')}>Hi</div>"
    expect(hasGradients(code)).toBe(true)
    expect(hasGradients(stripGradients(code))).toBe(false)
  })
})

describe('output-validator findTagClose apostrophe guard (#2085-class)', () => {
  it('still finds a real unwired duplicate sidebar whose attrs contain a malformed single-quoted apostrophe', () => {
    const code = `
      function Layout() {
        return (
          <div>
            <nav data-agent-context="sidebar" className="w-64 fixed -translate-x-full md:translate-x-0">Primary</nav>
            <nav data-agent-context="sidebar-mobile" title='Visitor's menu' className="w-64">Mobile</nav>
          </div>
        )
      }
    `
    const findings = findUnwiredDuplicateSidebar(code)
    expect(findings.some((f) => f.includes('sidebar-mobile'))).toBe(true)
  })
})

describe('dedupe-provided-components isInsideStringLiteral apostrophe guard (#2085)', () => {
  it('still truncates a real "Available Shadcn components" hint after an unrelated earlier decade-apostrophe', () => {
    const code = `function Hero() {
  return <p>Retro styles from the '90s are back.</p>
}

// Available Shadcn components: Button, Card
some trailing scaffold text that should be stripped`
    const out = dedupeProvidedComponents(code)
    expect(out).not.toContain('trailing scaffold text')
  })
})
