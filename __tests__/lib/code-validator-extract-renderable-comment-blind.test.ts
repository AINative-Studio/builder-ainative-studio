import { describe, it, expect } from 'vitest'
import { extractRenderableCode } from '@/lib/code-validator'

/**
 * Real bug (#1962, this loop's overnight comment/string-blindness sweep):
 * extractRenderableCode()'s multi-file split matched `// --- FILE:` against
 * the RAW content with `content.split(...)`, with no awareness of a
 * marker-shaped line sitting inside another file's own block comment,
 * line comment, or string/template literal. A generated docs/API-product
 * page that displays this project's own multi-file convention as example
 * text (inside a `<pre>`/syntax-highlighted sample or a backtick template)
 * had that embedded line mistaken for a real file boundary, so the parse
 * gate (isRenderable) and repair-app's revalidation both operated on the
 * wrong chunk of code.
 *
 * Note extractRenderableCode's own marker regex is NOT anchored to a full
 * line (unlike the other three call sites below, which test `^...$` on a
 * whole line), so even a single-line quoted string containing marker-shaped
 * text is a real risk here, not just multi-line constructs.
 *
 * Same bug class, same fix shape as flatten-multifile
 * .ts's parseFiles() (#1933), multi-file-parser.ts's parseMultiFileOutput()
 * (#1939), and sandbox-builder.ts's extractMainFileContent() (#1949).
 */
describe('extractRenderableCode — comment/string-blindness (#1962)', () => {
  it('a FILE-marker-shaped line nested inside a block comment is not treated as a real file boundary', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      "import React from 'react'",
      '/**',
      ' * Example of our multi-file generation convention:',
      ' * // --- FILE: src/components/Example.tsx ---',
      ' */',
      'export default function App() {',
      '  return <div>Docs page explaining our convention</div>',
      '}',
    ].join('\n')
    const extracted = extractRenderableCode(raw)
    expect(extracted).toContain('// --- FILE: src/components/Example.tsx ---')
    expect(extracted).toContain('function App')
  })

  it('a FILE-marker-shaped line nested inside a backtick template literal is not treated as a real file boundary', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      "import React from 'react'",
      'const snippet = `',
      '// --- FILE: src/components/Example.tsx ---',
      'export default function Example(){}',
      '`',
      'export default function App() {',
      '  return <pre>{snippet}</pre>',
      '}',
    ].join('\n')
    const extracted = extractRenderableCode(raw)
    expect(extracted).toContain('// --- FILE: src/components/Example.tsx ---')
    expect(extracted).toContain('function App')
  })

  it('a FILE-marker-shaped line nested inside a single-line string is not treated as a real file boundary', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      "import React from 'react'",
      "const docLine = '// --- FILE: src/components/Example.tsx ---'",
      'export default function App() {',
      '  return <p>{docLine}</p>',
      '}',
    ].join('\n')
    const extracted = extractRenderableCode(raw)
    expect(extracted).toContain('function App')
    expect(extracted).toContain("'// --- FILE: src/components/Example.tsx ---'")
  })

  it('real multi-file markers at top level still split normally, picking App.tsx', () => {
    const raw = [
      '// --- FILE: src/components/Sidebar.tsx ---',
      "export default function Sidebar(){ return <aside/> }",
      '// --- FILE: src/App.tsx ---',
      "import Sidebar from './components/Sidebar'",
      'export default function App(){ return <Sidebar/> }',
    ].join('\n')
    const extracted = extractRenderableCode(raw)
    expect(extracted).toContain('function App')
    expect(extracted).not.toContain('function Sidebar')
  })

  it('single-file content with no FILE markers at all passes through unchanged', () => {
    const raw = `export default function App() {
  return <div>Hello</div>
}`
    expect(extractRenderableCode(raw)).toBe(raw)
  })
})
