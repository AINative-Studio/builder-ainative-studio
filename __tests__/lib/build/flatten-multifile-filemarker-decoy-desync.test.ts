import { describe, it, expect } from 'vitest'
import { parseFiles, flattenMultiFile } from '@/lib/build/flatten-multifile'

/**
 * #2034/#2053/#2081-class bug (#2083): flatten-multifile.ts's own local
 * findStringEnd-based maskStringsAndComments()/linesInsideMultilineConstruct()
 * had no check that a fake string open — a decade-style apostrophe ("the
 * '90s") or a leading quote not preceded by a word character — whose only
 * candidate same-quote close sits on a LATER line was never a real string
 * at all. That let a bogus "string" span swallow a real backtick template
 * literal or `// --- FILE: ... ---`-shaped line that starts inside it.
 */
describe('flatten-multifile.ts apostrophe/newline desync (#2083)', () => {
  it('parseFiles: a FILE-marker-shaped line inside a backtick demo block is not mistaken for a real boundary when a decade-style apostrophe precedes it', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      "const copy = \"Styles from the '90s are back.\"",
      'const snippet = `',
      '// --- FILE: src/components/Example.tsx ---',
      'export default function Example(){}',
      '`',
      'export default function App() {',
      '  return <pre>{snippet}</pre>',
      '}',
    ].join('\n')
    const files = parseFiles(raw)
    expect(Object.keys(files)).not.toContain('src/components/Example.tsx')
    expect(files['src/App.tsx']).toContain('// --- FILE: src/components/Example.tsx ---')
    expect(files['src/App.tsx']).toContain('function App')
  })

  it('flattenMultiFile: a demo "export { Foo }" line inside a backtick string survives untouched when a decade-style apostrophe precedes it', () => {
    const multi = [
      '// --- FILE: src/App.tsx ---',
      "import Header from './components/Header'",
      "const copy = \"Styles from the '90s are back.\"",
      'const demo = `',
      'Here is how it works:',
      "import Foo from './foo'",
      'export { Foo }',
      '`',
      'export default function App(){ return (<div><Header/><pre>{demo}</pre></div>) }',
      '// --- FILE: src/components/Header.tsx ---',
      "import React from 'react'",
      'export default function Header(){ return <header>Brand</header> }',
    ].join('\n')
    const out = flattenMultiFile(multi)
    // The demo text must survive byte-for-byte — not rewritten as if it were
    // a real top-level named-export statement.
    expect(out).toContain('export { Foo }')
    expect(out).toContain('function Header')
    expect(out).toContain('function App')
  })

  it('flattenMultiFile: real local imports/exports still flatten normally in the presence of an ordinary contraction', () => {
    const multi = [
      '// --- FILE: src/App.tsx ---',
      "import Header from './components/Header'",
      "const copy = \"We're live.\"",
      'export default function App(){ return (<div><Header/></div>) }',
      '// --- FILE: src/components/Header.tsx ---',
      "import React from 'react'",
      'export default function Header(){ return <header>Brand</header> }',
    ].join('\n')
    const out = flattenMultiFile(multi)
    expect(out).toContain('function App')
    expect(out).toContain('function Header')
    expect(out).not.toMatch(/import\s+\w+\s+from\s*['"]\.\.?\//)
    expect(out).not.toMatch(/export\s+default/)
  })
})
