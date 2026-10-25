import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * A sibling component file can genuinely exist and resolve, yet still throw
 * "Element type is invalid: ... got: undefined" if the importer requests
 * the wrong export shape: a default import of a named-only export, or a
 * named import of a default-only export. The file exists (so
 * stubMissingLocalComponents never fires) and the specifier resolves (so
 * nothing else flags it) — only the actual binding is undefined at render.
 */
describe('buildSandpackFiles — fixExportShapeMismatches corrects a real file imported with the wrong export shape', () => {
  it('rewrites a default import of a named-only export to a named import', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import Footer from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'export const Footer = () => <footer>hi</footer>',
      ].join('\n'),
    })
    expect(built['/src/App.tsx']).toMatch(/import\s*\{\s*Footer\s*\}\s*from\s*['"]\.\/components\/Footer['"]/)
    expect(built['/src/App.tsx']).not.toMatch(/^import Footer from/m)
  })

  it('rewrites a single named import of a default-only export to a default import', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import { Footer } from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'export default function Footer() { return <footer>hi</footer> }',
      ].join('\n'),
    })
    expect(built['/src/App.tsx']).toMatch(/^import Footer from ['"]\.\/components\/Footer['"]/m)
  })

  it('preserves a local alias when rewriting a named-to-default mismatch', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import { Footer as F } from './components/Footer'",
        'export default function App() { return (<div><F/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'export default function Footer() { return <footer>hi</footer> }',
      ].join('\n'),
    })
    expect(built['/src/App.tsx']).toMatch(/^import F from ['"]\.\/components\/Footer['"]/m)
  })

  it('leaves a correctly-shaped default import untouched', () => {
    const files = {
      '/src/App.tsx': [
        "import Footer from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'export default function Footer() { return <footer>hi</footer> }',
      ].join('\n'),
    }
    const built = buildSandpackFiles(files)
    expect(built['/src/App.tsx']).toMatch(/^import Footer from ['"]\.\/components\/Footer['"]/m)
  })

  it('leaves a genuinely missing export alone (not this fix\'s job)', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import NotReal from './components/Footer'",
        'export default function App() { return (<div><NotReal/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'export const Footer = () => <footer>hi</footer>',
      ].join('\n'),
    })
    // Neither a default nor a matching named export exists for `NotReal` —
    // this fix must not guess; the import is left exactly as generated.
    expect(built['/src/App.tsx']).toMatch(/^import NotReal from ['"]\.\/components\/Footer['"]/m)
  })
})
