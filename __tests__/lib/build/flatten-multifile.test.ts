import { describe, it, expect } from 'vitest'
import { flattenMultiFile, parseFiles, hasLocalImports } from '@/lib/build/flatten-multifile'

const multi = [
  '// --- FILE: src/App.tsx ---',
  "import Header from './components/Header'",
  "import Hero from './components/Hero'",
  'export default function App(){ return (<div><Header/><Hero/></div>) }',
  '// --- FILE: src/components/Header.tsx ---',
  "import React from 'react'",
  'export default function Header(){ return <header>Brand</header> }',
  '// --- FILE: src/components/Hero.tsx ---',
  'export default function Hero(){ return <section>Hero</section> }',
].join('\n')

describe('flatten-multifile (#308)', () => {
  it('parses FILE markers into a files map', () => {
    const files = parseFiles(multi)
    expect(Object.keys(files).length).toBe(3)
    expect(files['src/App.tsx']).toContain('function App')
  })

  it('detects local imports', () => {
    expect(hasLocalImports("import Header from './components/Header'")).toBe(true)
    expect(hasLocalImports("import React from 'react'")).toBe(false)
  })

  it('inlines child components into one module so <Header/> resolves', () => {
    const out = flattenMultiFile(multi)
    // all three components present as top-level definitions
    expect(out).toContain('function App')
    expect(out).toContain('function Header')
    expect(out).toContain('function Hero')
    // NO relative imports remain (they cannot resolve in the Babel scope)
    expect(out).not.toMatch(/import\s+\w+\s+from\s*['"]\.\.?\//)
    // NO leftover `export default` (would break the top-level script scope)
    expect(out).not.toMatch(/export\s+default/)
  })

  it('places children BEFORE App (definitions available when App renders)', () => {
    const out = flattenMultiFile(multi)
    expect(out.indexOf('function Header')).toBeLessThan(out.indexOf('function App'))
  })

  it('single-file input is returned unchanged — flattening is a no-op (no regression)', () => {
    const single = '// --- FILE: src/App.tsx ---\nexport default function App(){ return <div>hi</div> }'
    const out = flattenMultiFile(single)
    expect(out).toContain('function App')
    // single-file is left as-is; the preview route's existing render handles export default.
    expect(out).toBe('export default function App(){ return <div>hi</div> }')
  })

  it('multi-file where App has NO local imports → just strips exports', () => {
    const noimports = [
      '// --- FILE: src/App.tsx ---',
      'export default function App(){ return <div>standalone</div> }',
      '// --- FILE: src/data/sample.ts ---',
      'export const data = [1,2,3]',
    ].join('\n')
    const out = flattenMultiFile(noimports)
    expect(out).toContain('function App')
  })

  it('stubs a DANGLING import the generator never emitted (aerosol Cart/Footer bug)', () => {
    const dangling = [
      '// --- FILE: src/App.tsx ---',
      "import Header from './components/Header'",
      "import Cart from './components/Cart'",   // no Cart.tsx file emitted
      'export default function App(){ return (<div><Header/><Cart/></div>) }',
      '// --- FILE: src/components/Header.tsx ---',
      'export default function Header(){ return <header>H</header> }',
    ].join('\n')
    const out = flattenMultiFile(dangling)
    expect(out).toMatch(/function Header\b/)      // real one inlined
    expect(out).toMatch(/function Cart\b/)        // dangling one stubbed
    expect(out).toMatch(/stub:/)                  // marked as a stub
    expect(out).not.toMatch(/import\s+Cart\s+from/) // import removed → no throw
  })

  it('handles transitive local imports (App→Grid→Card)', () => {
    const nested = [
      '// --- FILE: src/App.tsx ---',
      "import Grid from './components/Grid'",
      'export default function App(){ return <Grid/> }',
      '// --- FILE: src/components/Grid.tsx ---',
      "import Card from './Card'",
      'export default function Grid(){ return <Card/> }',
      '// --- FILE: src/components/Card.tsx ---',
      'export default function Card(){ return <div>card</div> }',
    ].join('\n')
    const out = flattenMultiFile(nested)
    expect(out).toContain('function App')
    expect(out).toContain('function Grid')
    expect(out).toContain('function Card')
    // Card (deepest) before Grid before App
    expect(out.indexOf('function Card')).toBeLessThan(out.indexOf('function Grid'))
    expect(out.indexOf('function Grid')).toBeLessThan(out.indexOf('function App'))
  })
})
