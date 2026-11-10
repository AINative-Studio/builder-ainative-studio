import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * #1943: rewriteBarrelImports/rewriteHallucinatedPackages ran a plain
 * code.replace(regex, ...) against the raw, unmasked file text — matching
 * an import-shaped string anywhere, including inside a backtick/quoted
 * string literal (e.g. a landing page rendering a code sample). That
 * silently rewrote the displayed content instead of leaving it alone.
 */
describe('rewriteBarrelImports — does not rewrite import-shaped text inside a string/template literal', () => {
  it('leaves a bare "./components" barrel import mentioned inside a template-literal code sample untouched', () => {
    const code = [
      'export default function App() {',
      "  const sample = `import { Button, Card } from './components'`",
      '  return <pre>{sample}</pre>',
      '}',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toContain("const sample = `import { Button, Card } from './components'`")
  })

  it('still rewrites a REAL top-level bare "./components" barrel import', () => {
    const code = [
      "import { Button, Card } from './components'",
      '',
      'export default function App() { return <><Button /><Card /></> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toMatch(/import\s*\{\s*Button\s*\}\s*from\s*['"]\.\/components\/ui\/button['"]/)
    expect(out).toMatch(/import\s*\{\s*Card\s*\}\s*from\s*['"]\.\/components\/ui\/card['"]/)
    expect(out).not.toMatch(/from\s*['"]\.\/components['"]/)
  })
})

describe('rewriteHallucinatedPackages — does not rewrite import-shaped text inside a string/template literal', () => {
  it('leaves a hallucinated-package-shaped mention inside a template-literal code sample untouched', () => {
    const code = [
      'export default function App() {',
      "  const sample = `import { Widget } from 'AINativeWidgets'`",
      '  return <pre>{sample}</pre>',
      '}',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toContain("const sample = `import { Widget } from 'AINativeWidgets'`")
  })

  it('still rewrites a REAL top-level hallucinated bare-CamelCase package import', () => {
    const code = [
      "import { Widget } from 'AINativeWidgets'",
      '',
      'export default function App() { return <Widget /> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toMatch(/import\s*\{\s*Widget\s*\}\s*from\s*['"]\.\/components\/aikit['"]/)
    expect(out).not.toMatch(/from\s*['"]AINativeWidgets['"]/)
  })
})
