import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Regression for #1879: rewriteBarrelImports() matched its regex anywhere in
 * the raw source, including inside a `//` comment, before splitting the
 * imported names into one `import` line per target package. The first
 * generated line stayed commented (it sits right after the original `//`),
 * but any ADDITIONAL line the split adds is a brand-new source line with no
 * `//` of its own — resurrecting a disabled/example barrel import as real,
 * executing code.
 */
describe('rewriteBarrelImports comment safety', () => {
  it('does not resurrect a commented-out barrel import as real code', () => {
    const code = [
      "// import { Button, ResponsiveContainer } from './components'",
      'const x = 1',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/^import \{ Button \}/m)
    expect(out).not.toMatch(/^import \{ ResponsiveContainer \}/m)
    expect(out).toContain('const x = 1')
  })

  it('still splits a REAL (uncommented) barrel import across packages', () => {
    const code = "import { Button, ResponsiveContainer } from './components'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/import \{ Button \} from '\.\/components\/ui\/button'/)
    expect(out).toMatch(/import \{ ResponsiveContainer \} from 'recharts'/)
  })

  it('leaves a barrel import mentioned only inside a block comment untouched', () => {
    const code = [
      '/*',
      " * import { Button } from './components'",
      ' */',
      'const x = 1',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/^import \{ Button \}/m)
  })
})
