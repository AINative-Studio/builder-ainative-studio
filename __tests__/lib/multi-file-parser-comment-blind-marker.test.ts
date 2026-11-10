import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'

/**
 * Real bug (this loop's overnight comment/string-blindness sweep):
 * parseMultiFileOutput()'s main loop matched FILE_MARKER against every RAW
 * line of the model's output, with no awareness of a line sitting inside
 * another file's own block comment or backtick template literal. A
 * generated file documenting or demonstrating this project's own
 * `// --- FILE:` convention inside such a construct — an ordinary thing for
 * a generated docs/API-product page — had that embedded line mistaken for a
 * real file boundary, splitting the real file mid-content and clobbering
 * whatever followed under the reused marker name. Same bug class, same fix
 * shape as flatten-multifile.ts's parseFiles() (#1933/PR #1934).
 */
describe('parseMultiFileOutput — comment/template-blindness', () => {
  it('a FILE-marker-shaped line nested inside a block comment is not treated as a real file boundary', () => {
    const raw = [
      '// --- FILE: src/components/Docs.tsx ---',
      "import React from 'react'",
      '',
      '/**',
      ' * Example of our multi-file generation convention:',
      ' * // --- FILE: src/components/Example.tsx ---',
      ' */',
      'export default function Docs() {',
      '  return <div>Docs page explaining our convention</div>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    expect(Object.keys(files)).not.toContain('/src/components/Example.tsx')
    expect(files['/src/components/Docs.tsx']).toContain('// --- FILE: src/components/Example.tsx ---')
    expect(files['/src/components/Docs.tsx']).toContain('function Docs')
  })

  it('a FILE-marker-shaped line nested inside a multi-line backtick template literal is not treated as a real file boundary', () => {
    const raw = [
      '// --- FILE: src/components/Docs.tsx ---',
      "import React from 'react'",
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

  it('real multi-file markers at top level still split normally', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
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
