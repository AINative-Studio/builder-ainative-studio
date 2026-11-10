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

/**
 * Real bug found this run (#1919): shapeOf()'s hasDefault/named/defaultRhs
 * scans all read the target file's RAW, unmasked text — same bug class as
 * #1900 (buildLocalExportMap), just in this sibling function. A comment
 * merely MENTIONING an "export default Name" or "export const Name" line
 * (an old approach kept "for reference" after a refactor) reads as a real
 * export shape, which doesn't just fail to help — it actively SUPPRESSES
 * the real fix a genuinely wrong-shaped import still needs, leaving the
 * exact "Element type is invalid: ... got: undefined" crash this function
 * exists to prevent.
 */
describe('buildSandpackFiles — fixExportShapeMismatches is comment-blind to a merely-mentioned export shape (#1919)', () => {
  it('still redirects a bare default import to named when a comment falsely claims a default export exists', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import Footer from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        '// old approach: export default Footer',
        'export const Footer = () => <footer>hi</footer>',
      ].join('\n'),
    })
    // Footer.tsx's ONLY real export is the named one. Pre-fix, the decoy
    // comment made shapeOf().hasDefault wrongly read true, which gates off
    // this branch entirely (`!shape.hasDefault`) and leaves the bare
    // default import unfixed — it must still get corrected here.
    expect(built['/src/App.tsx']).toMatch(/import \{ Footer \} from ['"]\.\/components\/Footer['"]/)
    expect(built['/src/App.tsx']).not.toMatch(/^import Footer from/m)
  })

  it('still redirects a named import to default when a comment falsely claims a matching named export exists', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import { Footer } from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        '// old: export const Footer = () => <footer>old</footer>',
        'export default function Footer() { return <footer>hi</footer> }',
      ].join('\n'),
    })
    // Footer.tsx's ONLY real export is the default one. Pre-fix, the decoy
    // comment made shapeOf().named wrongly contain 'Footer', which suppresses
    // this branch (`!shape.named.has(exported)`) and leaves the named import
    // unfixed — it must still get corrected here.
    expect(built['/src/App.tsx']).toMatch(/^import Footer from ['"]\.\/components\/Footer['"]/m)
  })
})
