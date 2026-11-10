import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Regression: sanitizeImports()'s "broken multi-line import" heuristic
 * decides whether a line looks like the start/continuation of an unclosed
 * `import { ... }` purely from the raw line text, with no notion of a
 * string/template literal left open by an EARLIER line. A demo/example code
 * snippet shown on the page inside a template literal (a docs/SDK-style
 * landing page showing `import {`/`}` as plain text) is line-for-line
 * indistinguishable from a genuinely broken import, so the heuristic
 * "repairs" it by discarding those lines — including the literal's own
 * closing backtick — leaving the template literal unterminated, a real
 * syntax error the generation never had.
 */
describe('sanitizeImports (via fixJsxErrors) — string/template-literal-blind broken-import scan', () => {
  it('does not discard a demo "import {" snippet (and its closing backtick) inside a template literal', () => {
    const code = [
      'const demo = `',
      'import {',
      '  Foo',
      '`',
      "import React from 'react'",
      'export default function App() { return <div>{demo}</div> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    // The template literal must still be terminated — its closing backtick
    // must survive, and the demo text inside it must be untouched.
    expect(out).toMatch(/const demo = `\nimport \{\n {2}Foo\n`/)
    // The real import right after the literal must still be present.
    expect(out).toMatch(/import React from ['"]react['"]/)
  })

  it('does not discard a demo "import {" snippet followed by a real import, both inside the same template literal', () => {
    const code = [
      'const demo = `',
      'import {',
      '  Foo',
      "import Bar from './bar'",
      '`',
      'export default function App() { return <div>{demo}</div> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    // Everything inside the backticks is just display text — none of it
    // should be dropped, and the literal must stay terminated.
    expect(out).toContain('import {')
    expect(out).toContain("import Bar from './bar'")
    expect(out).toMatch(/`\nexport default function App/)
  })

  it('still discards a genuinely broken (real, non-string) unclosed import followed by another real import — no regression', () => {
    const code = [
      'import {',
      '  Foo, // placeholder { for future use }',
      "import Bar from './bar'",
      '',
      'export default function App() { return <><Foo /><Bar /></> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/^import\s+\{/m)
    expect(out).toMatch(/import Bar from ['"]\.\/bar['"]/)
  })

  it('still closes a real multi-line import normally when the brace is real — no regression', () => {
    const code = [
      'import {',
      '  Foo,',
      '  Bar',
      "} from './components/x'",
      '',
      'export default function App() { return <><Foo /><Bar /></> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toMatch(/Foo,\s*\n\s*Bar\s*\n\}\s*from\s*['"]\.\/components\/x['"]/)
  })
})
