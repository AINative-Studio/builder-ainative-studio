import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'

/**
 * Real bug (overnight-loop static sweep, 2026-10-25): `parseMultiFileOutput`'s
 * "ensure entry point exists" fallback only fires when the raw multi-file
 * output used FILE markers but never named a top-level `/src/App.tsx` or
 * `/App.tsx` (e.g. it marked its main file `page.tsx` instead). That fallback
 * re-exported `mainFile`'s default export under a NAME it extracted with
 * `extractDefaultExport()` — but default-export imports bind positionally,
 * not by name, so the extraction was never actually necessary for the import
 * to work. When extraction failed (an anonymous `export default () => {}` /
 * `export default function() {}` matches none of its three regexes), the old
 * code treated that as "nothing to do" and created NO entry point at all.
 * Sandpack's fixed `/index.tsx` always does `import App from './App'`, so a
 * missing entry guarantees a blank/crashed preview — exactly the priority-1
 * rendering failure this sweep exists to catch, not a degraded one.
 */
describe('parseMultiFileOutput: entry-point synthesis for a mainFile with no App.tsx marker', () => {
  it('synthesizes /src/App.tsx for a named default export (baseline, already worked)', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default function HomePage() {',
      '  return <div>hi</div>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toContain("from './page'")
    expect(files['/src/App.tsx']).toMatch(/export default HomePage/)
  })

  it('still synthesizes /src/App.tsx when the mainFile export is an anonymous arrow function', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default () => {',
      '  return <div>hi</div>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toBeDefined()
    expect(files['/src/App.tsx']).toContain("from './page'")
    expect(files['/src/App.tsx']).toMatch(/^import \w+ from '\.\/page'\nexport default \w+$/)
  })

  it('still synthesizes /src/App.tsx when the mainFile export is an anonymous function', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default function() {',
      '  return <div>hi</div>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toBeDefined()
    expect(files['/src/App.tsx']).toContain("from './page'")
  })

  it('#1519: synthesizes a real entry point for a named class component with extends (not `import class from`)', () => {
    // Real bug: extractDefaultExport()'s bare-identifier fallback regex
    // (/export\s+default\s+(\w+)/) greedily captured the reserved word
    // "class" itself for any class-component export — never-null, so the
    // existing || 'GeneratedMainPage' safety net never engaged. The
    // synthesized entry point was `import class from './page'` — a
    // guaranteed Babel SyntaxError at render.
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default class HomePage extends React.Component {',
      '  render() { return <div>hi</div> }',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toBeDefined()
    expect(files['/src/App.tsx']).not.toMatch(/import\s+class\s+from/)
    expect(files['/src/App.tsx']).toContain('import HomePage ')
    expect(files['/src/App.tsx']).toMatch(/export default HomePage$/)
  })

  it('#1519: synthesizes a real entry point for a named class component with no extends', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      'export default class HomePage {',
      '  render() { return <div>hi</div> }',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).not.toMatch(/import\s+class\s+from/)
    expect(files['/src/App.tsx']).toContain('import HomePage ')
  })

  it('#1519: synthesizes a real entry point (via the GeneratedMainPage fallback) for a fully anonymous class component', () => {
    // A genuinely anonymous class has no name to extract — must correctly
    // return null so the caller's `|| 'GeneratedMainPage'` fallback engages,
    // not mis-capture "extends" as the name.
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default class extends React.Component {',
      '  render() { return <div>hi</div> }',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).not.toMatch(/import\s+(class|extends)\s+from/)
    expect(files['/src/App.tsx']).toContain('import GeneratedMainPage ')
  })

  it('does not overwrite an already-present /src/App.tsx', () => {
    const raw = [
      '// --- FILE: /src/App.tsx ---',
      "import React from 'react'",
      'export default function App() { return <div>real app</div> }',
      '// --- FILE: /src/page.tsx ---',
      'export default () => { return <div>unrelated</div> }',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toContain('real app')
  })
})
