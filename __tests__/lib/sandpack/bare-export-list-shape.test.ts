import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real gap in the #1498 fix (fixExportShapeMismatches) and in the #1099
 * item 4 fix (buildLocalExportMap): both detect a local named export only
 * via `export const/function/class Name` — an inline `export` keyword on
 * the declaration itself. Neither recognizes shadcn/ui's own canonical
 * convention of declaring a component WITHOUT `export`, then exporting it
 * via a trailing bare list: `function Footer() {...}` then, separately,
 * `export { Footer }`. A component exported only this way previously read
 * as having NO named export at all, so:
 *  - a bare default import of it was never corrected to a named import
 *    (fixExportShapeMismatches), and
 *  - a sibling using it in JSX without importing it never got the import
 *    injected (buildLocalExportMap) —
 * both leaving a real, correctly-exported component to resolve as
 * `undefined` at render time, throwing "Element type is invalid" exactly
 * like a genuinely missing/misshapen export.
 */
describe('buildSandpackFiles — recognizes bare `export { Name }` list exports', () => {
  it('rewrites a default import of a bare-list-only named export to a named import', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import Footer from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'function Footer() { return <footer>hi</footer> }',
        'export { Footer }',
      ].join('\n'),
    })
    expect(built['/src/App.tsx']).toMatch(/import\s*\{\s*Footer\s*\}\s*from\s*['"]\.\/components\/Footer['"]/)
    expect(built['/src/App.tsx']).not.toMatch(/^import Footer from/m)
  })

  it('resolves an aliased bare-list export (`export { Internal as Footer }`) by its external name', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import Footer from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'function FooterImpl() { return <footer>hi</footer> }',
        'export { FooterImpl as Footer }',
      ].join('\n'),
    })
    expect(built['/src/App.tsx']).toMatch(/import\s*\{\s*Footer\s*\}\s*from\s*['"]\.\/components\/Footer['"]/)
  })

  it('injects a missing import for a sibling exported only via a bare list and used in JSX', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <Widget/> }",
      '/components/Shared.tsx': [
        'const Widget = () => <div>w</div>',
        'export { Widget }',
      ].join('\n'),
    })
    expect(built['/App.tsx']).toContain("import { Widget } from './components/Shared'")
  })

  it('does not treat a re-export (`export { X } from "./Y"`) as a local declaration', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <Widget/> }",
      '/components/Reexport.tsx': "export { Widget } from './Elsewhere'",
    })
    // No local declaration of Widget anywhere, so nothing should be injected
    // pointing at the re-export file — this stays a genuinely unresolved
    // case rather than a guessed-wrong import.
    expect(built['/App.tsx']).not.toContain("from './components/Reexport'")
  })
})
