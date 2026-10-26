import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'

/**
 * Issue #1523 migration: `parseMultiFileOutput`'s "ensure entry point exists"
 * fallback now names the synthesized `/src/App.tsx` import using
 * `component-detector.ts`'s `detectRootComponent()` instead of this file's
 * own hand-rolled `extractDefaultExport()`. The import name is cosmetic only
 * (a default-export import binds positionally, not by name), so this test
 * file focuses on the cases where the two extractors actually disagree: a
 * class-component mainFile, where the OLD `extractDefaultExport()` regex
 * `/export\s+default\s+(\w+)/` greedily captures the bare keyword `class`
 * itself (producing an uncompilable `import class from './page'`), while
 * `detectRootComponent()`'s priority-1 regexes require `[A-Z]` right after
 * `class`/`default`, so they never match the keyword.
 *
 * This is a static/code-level repro only — no live Sandpack/browser render
 * was exercised (this cloud environment currently has no outbound network
 * access to builder.ainative.studio / api.ainative.studio; see #1265).
 */
describe('parseMultiFileOutput: entry-point naming uses detectRootComponent() (#1523)', () => {
  it('named class component: synthesizes a valid import, not `import class from ...`', () => {
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

  it('anonymous class component: synthesizes a valid import, not `import class from ...`', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default class extends React.Component {',
      '  render() { return <div>hi</div> }',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toBeDefined()
    expect(files['/src/App.tsx']).not.toMatch(/\bimport\s+class\b/)
    // detectRootComponent() synthesizes '__PreviewDefault' for an anonymous
    // default export; the exact name doesn't matter (binding is positional),
    // only that it's a valid, non-reserved-word identifier.
    expect(files['/src/App.tsx']).toMatch(/^import \w+ from '\.\/page'\nexport default \w+$/)
  })

  it('named function component (baseline): still resolves the real name', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default function HomePage() {',
      '  return <div>hi</div>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toMatch(/^import HomePage from '\.\/page'\nexport default HomePage$/)
  })

  it('anonymous arrow default export (regression guard for #1507): still synthesizes a valid entry point', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      "import React from 'react'",
      'export default () => {',
      '  return <div>hi</div>',
      '}',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toBeDefined()
    expect(files['/src/App.tsx']).toMatch(/^import \w+ from '\.\/page'\nexport default \w+$/)
  })

  it('export default new Foo() (reserved-word regression guard): does not capture "new" as the name', () => {
    const raw = [
      '// --- FILE: /src/page.tsx ---',
      'class HomePage extends React.Component { render() { return <div>hi</div> } }',
      'export default new HomePage()',
    ].join('\n')
    const files = parseMultiFileOutput(raw, 'test prompt')
    expect(files['/src/App.tsx']).toBeDefined()
    expect(files['/src/App.tsx']).not.toMatch(/\bimport\s+new\b/)
  })
})
