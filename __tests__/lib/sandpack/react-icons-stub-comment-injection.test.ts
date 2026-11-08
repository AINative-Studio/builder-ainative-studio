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
})
