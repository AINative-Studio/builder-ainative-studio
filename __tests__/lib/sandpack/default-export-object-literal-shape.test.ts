import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real gap found live (overnight loop static analysis, investigating #1539
 * — "Element type is invalid ... but got: object" on silo-product's cold
 * load): `fixExportShapeMismatches()`'s `singleNamed` correction branch
 * treats ANY `export default` text in a target file as proof that the
 * default export IS the single named component being imported — it never
 * checks what the default export's own value actually is.
 *
 * A sibling file that declares a component without `export` and then
 * default-exports a plain OBJECT literal referencing it (`export default {
 * Footer }` — a plausible model mistake, confusing the object-shorthand
 * convention with re-exporting the component itself) has `shape.hasDefault
 * === true` but no real named export `Footer` either. Before this fix,
 * `import { Footer } from './Footer'` (which — correctly, if uselessly —
 * resolves to `undefined` per real ES module semantics, since there is no
 * top-level named export) got "corrected" by this safety net into `import
 * Footer from './Footer'`, which resolves to the OBJECT `{ Footer: fn }`
 * itself, not the component function inside it. Rendering `<Footer/>` then
 * throws "Element type is invalid ... but got: object" — turning an
 * already-broken import into a DIFFERENT crash signature, not fixing it.
 *
 * Same risk for a bare default reference to an unrelated identifier
 * (`export default SomethingElse`) — "has a default" is not "is the thing
 * being imported by this other name."
 */
describe('buildSandpackFiles — does not rewrite a named import into a default import of an unrelated/object default export', () => {
  it('leaves a named import alone when the target only default-exports an object literal referencing the name', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import { Footer } from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
      '/src/components/Footer.tsx': [
        "import React from 'react'",
        'function Footer() { return <footer>hi</footer> }',
        'export default { Footer }',
      ].join('\n'),
    })
    // Must NOT have been rewritten to a bare default import — that would
    // bind `Footer` to the object `{ Footer: fn }`, not the component.
    expect(built['/src/App.tsx']).not.toMatch(/^import Footer from/m)
    expect(built['/src/App.tsx']).toMatch(/import\s*\{\s*Footer\s*\}\s*from\s*['"]\.\/components\/Footer['"]/)
  })

  it('leaves a named import alone when the target default-exports a different, unrelated identifier', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { Footer } from './components/Footer'",
        'export default function App() { return <Footer/> }',
      ].join('\n'),
      '/components/Footer.tsx': [
        'function Footer() { return null }',
        'function Unrelated() { return null }',
        'export default Unrelated',
      ].join('\n'),
    })
    expect(built['/App.tsx']).not.toMatch(/^import Footer from/m)
  })

  it('still corrects a genuinely bare-default export matching the imported name (unchanged existing behavior)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { Footer } from './components/Footer'",
        'export default function App() { return <Footer/> }',
      ].join('\n'),
      '/components/Footer.tsx': [
        'function Footer() { return null }',
        'export default Footer',
      ].join('\n'),
    })
    expect(built['/App.tsx']).toMatch(/^import Footer from/m)
  })

  it('still corrects an anonymous default export (unchanged existing behavior)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { Footer } from './components/Footer'",
        'export default function App() { return <Footer/> }',
      ].join('\n'),
      '/components/Footer.tsx': [
        'export default function () { return null }',
      ].join('\n'),
    })
    expect(built['/App.tsx']).toMatch(/^import Footer from/m)
  })
})
