import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Regression for #1879: stubUnsupportedIconLibraries()'s regex matched
 * anywhere in the raw source, including inside a `//` comment, before
 * splitting the imported icon names into one `const` stub per icon. The
 * first generated line stayed commented (it sits right after the original
 * `//`), but any ADDITIONAL line was a brand-new source line with no `//`
 * of its own — resurrecting a disabled/example react-icons import as real
 * code. Worse than the sibling bugs fixed in the same PR: each stub line
 * itself ends in a trailing `// Auto-stubbed...` comment, so the very next
 * REAL line of source was silently swallowed into that comment too.
 */
describe('stubUnsupportedIconLibraries comment safety', () => {
  it('does not resurrect a commented-out react-icons import as real code', () => {
    const code = ["// import { FaRegCircle, FaStar } from 'react-icons/fa'", 'const x = 1'].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/^const FaStar/m)
    // The real next line of code must survive, not get swallowed into a
    // trailing `//` comment from a resurrected stub.
    expect(out).toContain('const x = 1')
  })

  it('still stubs a REAL (uncommented) multi-icon react-icons import', () => {
    const code = "import { FaRegCircle, FaStar } from 'react-icons/fa'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/const FaRegCircle = \(_props: any\) => null/)
    expect(out).toMatch(/const FaStar = \(_props: any\) => null/)
    expect(out).not.toMatch(/from ['"]react-icons\//)
  })

  /**
   * Overnight loop, 2026-11-14 (#2022 follow-up, found while adding a
   * render-time truncated-file safety net): the regex itself ended in
   * `\s*;?` — "optional whitespace, then an optional semicolon" — but `\s`
   * matches `\n` too. With NO trailing semicolon (common in semicolon-free
   * generated code), `\s*` greedily ate every following newline/blank line
   * right up to the next non-whitespace token, landing the WHOLE rest of
   * the component on the same line as the stub's own trailing `//`
   * comment — silently deleting it. Confirmed live by direct repro: a
   * one-icon import immediately followed on the next line by
   * `export default function App(){...}` lost that entire line into the
   * comment, leaving the file with no export at all. Fixed by narrowing the
   * optional-whitespace-before-a-semicolon match to `[ \t]*` (same line
   * only) so a trailing newline is never consumed.
   */
  it('does not swallow the next real line into its own trailing comment when the import has no trailing semicolon', () => {
    const code = [
      "import { FaRegCircle } from 'react-icons/fa'",
      'export default function App(){ return <FaRegCircle/> }',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toContain('const FaRegCircle = (_props: any) => null')
    // The real component declaration must survive on its own line, not get
    // appended to the stub's `//` comment.
    expect(out).toMatch(/^export default function App/m)
  })

  it('does not swallow a blank line + the next real line either (import followed by a blank line, as real generated code typically formats it)', () => {
    const code = [
      "import { FaRegCircle } from 'react-icons/fa'",
      '',
      'export default function App(){ return <FaRegCircle/> }',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toMatch(/^export default function App/m)
  })

  it('still consumes a real trailing semicolon on the same line (no behavior change for that case)', () => {
    const code = [
      "import { FaRegCircle } from 'react-icons/fa';",
      'export default function App(){ return <FaRegCircle/> }',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toContain(';;')
    expect(out).toMatch(/^export default function App/m)
  })
})
