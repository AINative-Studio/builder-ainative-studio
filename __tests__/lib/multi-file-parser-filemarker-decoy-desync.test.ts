import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'

/**
 * #2034/#2053/#2077-class bug, found in multi-file-parser.ts's own
 * duplicated linesInsideMultilineConstruct() (#2081): its quote-skip loop
 * had no notion of a fake string open (a decade-style apostrophe, or a
 * leading quote not preceded by a word character). With no same-line
 * close, it jumped straight past a real multi-line backtick template
 * literal that opens inside that bogus span — including a
 * `// --- FILE: ... ---`-shaped line nested inside it — without ever
 * marking those lines hidden, so the embedded marker got mistaken for a
 * real file boundary.
 */
describe('parseMultiFileOutput — apostrophe/newline desync (#2081)', () => {
  it('a FILE-marker-shaped line inside a backtick demo block is not mistaken for a real boundary when a decade-style apostrophe precedes it', () => {
    const raw = [
      '// --- FILE: src/components/Docs.tsx ---',
      "import React from 'react'",
      "const copy = \"Styles from the '90s are back.\"",
      'const snippet = `',
      '// --- FILE: src/components/Example.tsx ---',
      'export default function Example(){}',
      '`',
      'export default function Docs() {',
      '  return <pre>{snippet}</pre>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    expect(Object.keys(files)).not.toContain('/src/components/Example.tsx')
    expect(files['/src/components/Docs.tsx']).toContain('// --- FILE: src/components/Example.tsx ---')
    expect(files['/src/components/Docs.tsx']).toContain('function Docs')
  })

  it('a FILE-marker-shaped line inside a backtick demo block is not mistaken for a real boundary when a leading-quote apostrophe precedes it', () => {
    const raw = [
      '// --- FILE: src/components/Docs.tsx ---',
      "import React from 'react'",
      "const copy = \"'Tis the season for savings.\"",
      'const snippet = `',
      '// --- FILE: src/components/Example.tsx ---',
      'export default function Example(){}',
      '`',
      'export default function Docs() {',
      '  return <pre>{snippet}</pre>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    expect(Object.keys(files)).not.toContain('/src/components/Example.tsx')
    expect(files['/src/components/Docs.tsx']).toContain('// --- FILE: src/components/Example.tsx ---')
    expect(files['/src/components/Docs.tsx']).toContain('function Docs')
  })

  it('real multi-file markers at top level still split normally after a decade-style apostrophe', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      "const copy = \"Styles from the '90s are back.\"",
      "import Sidebar from './components/Sidebar'",
      'export default function App(){ return <Sidebar/> }',
      '// --- FILE: src/components/Sidebar.tsx ---',
      'export default function Sidebar(){ return <aside/> }',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    expect(Object.keys(files)).toContain('/src/App.tsx')
    expect(Object.keys(files)).toContain('/src/components/Sidebar.tsx')
    expect(files['/src/components/Sidebar.tsx']).toContain('function Sidebar')
  })
})
