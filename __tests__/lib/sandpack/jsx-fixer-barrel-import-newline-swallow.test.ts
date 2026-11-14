import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Regression for #2043: rewriteBarrelImports()'s regex ends in `\s*;?` —
 * `\s` matches `\n`, so with no trailing semicolon on the barrel import
 * (common in semicolon-free generated code) the match swallows every
 * following newline/blank line up to the next real token. The replacement
 * was built with `imports.join('\n')` and no trailing newline, so whatever
 * followed landed glued directly onto the last generated import line —
 * `'./components/ui/card'export default function App(){...}` — a hard
 * parse error that fails Sandpack's whole compile, not a silent swallow
 * like the sibling #2041/#1879 bugs in this same file.
 */
function assertParses(code: string) {
  expect(() => parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow()
}

describe('rewriteBarrelImports — does not glue the rewritten import onto the next line', () => {
  it('keeps the next statement on its own line when a blank line separates it from a no-semicolon barrel import', () => {
    const code = [
      "import { Button, Card } from './components'",
      '',
      'export default function App() { return <><Button /><Card /></> }',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/'export default/)
    expect(out).toMatch(/^export default function App/m)
    assertParses(out)
  })

  it('keeps a following import statement on its own line (no blank line, no semicolon)', () => {
    const code = [
      "import { Button, Card } from './components'",
      "import { useState } from 'react'",
      'export default function App() { const [x] = useState(0); return <><Button /><Card /></> }',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toMatch(/^import \{ useState \} from 'react'$/m)
    assertParses(out)
  })

  it('still parses correctly when the original barrel import has a trailing semicolon (control)', () => {
    const code = [
      "import { Button, Card } from './components';",
      'export default function App() { return <><Button /><Card /></> }',
    ].join('\n')
    const out = fixJsxErrors(code)
    assertParses(out)
  })

  it('keeps the next line intact for a single-package split (AIKit-only names)', () => {
    const code = [
      "import { MetricCard } from '../components'",
      'export default function App() { return <MetricCard /> }',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toMatch(/^export default function App/m)
    assertParses(out)
  })
})
