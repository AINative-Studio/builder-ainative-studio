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

  // Real bug (overnight-loop static sweep, 2026-10-25): extractDefaultExport()'s
  // second alternative, `/export\s+default\s+(\w+)/`, matches the reserved
  // word `class` itself whenever mainFile's default export is a class
  // component — named OR anonymous, with or without `extends` — because
  // `\w+` greedily grabs the literal keyword right after `default `, and the
  // first alternative (which requires the literal `function` keyword) never
  // matches a class at all. The synthesized entry point then does
  // `import class from './page'` — `class` is a reserved word and can never
  // be a binding identifier, so this is a guaranteed Babel SyntaxError /
  // blank preview, not a degraded one. Because the match is non-null (it's
  // the string "class"), the `|| 'GeneratedMainPage'` fallback #1507 added
  // for a genuinely-unmatched anonymous export never engages either.
  describe('mainFile default-exports a class component (extractDefaultExport must not capture the "class" keyword)', () => {
    it('named class component with `extends`', () => {
      const raw = [
        '// --- FILE: /src/page.tsx ---',
        "import React from 'react'",
        'export default class HomePage extends React.Component {',
        '  render() { return <div>hi</div> }',
        '}',
      ].join('\n')
      const files = parseMultiFileOutput(raw, 'test prompt')
      expect(files['/src/App.tsx']).toBeDefined()
      expect(files['/src/App.tsx']).not.toMatch(/\bimport\s+class\b/)
      expect(files['/src/App.tsx']).toMatch(/^import HomePage from '\.\/page'\nexport default HomePage$/)
    })

    it('named class component with no `extends`', () => {
      const raw = [
        '// --- FILE: /src/page.tsx ---',
        'export default class HomePage {',
        '  render() { return <div>hi</div> }',
        '}',
      ].join('\n')
      const files = parseMultiFileOutput(raw, 'test prompt')
      expect(files['/src/App.tsx']).not.toMatch(/\bimport\s+class\b/)
      expect(files['/src/App.tsx']).toMatch(/^import HomePage from '\.\/page'\nexport default HomePage$/)
    })

    it('anonymous class component falls back to the #1507 placeholder, not the "class" keyword', () => {
      const raw = [
        '// --- FILE: /src/page.tsx ---',
        'export default class extends React.Component {',
        '  render() { return <div>hi</div> }',
        '}',
      ].join('\n')
      const files = parseMultiFileOutput(raw, 'test prompt')
      expect(files['/src/App.tsx']).toBeDefined()
      expect(files['/src/App.tsx']).not.toMatch(/\bimport\s+class\b/)
      expect(files['/src/App.tsx']).toMatch(/^import \w+ from '\.\/page'\nexport default \w+$/)
    })
  })
})
