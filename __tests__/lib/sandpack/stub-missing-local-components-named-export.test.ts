import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Follow-up to #1122's stubMissingLocalComponents: that fix only ever
 * synthesizes a default export (`export default function Footer() { return
 * null }`), but a generated file can just as easily import a genuinely
 * missing sibling component with a NAMED import — `import { Footer } from
 * './components/Footer'` — which is equally common model output for a
 * small/shared piece (e.g. a named `IconBadge`, `StatCard`). The existing
 * stub leaves that named binding `undefined`, so rendering `<Footer/>`
 * still throws "Element type is invalid: ... got: undefined" — the exact
 * whole-preview crash #1122 set out to prevent, just reached through the
 * named-import path instead of the default-import one.
 */
describe('buildSandpackFiles — stubMissingLocalComponents must satisfy a named import, not just default (#1122 follow-up)', () => {
  it('synthesizes a named export stub for a missing sibling component imported by name', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import { Footer } from './components/Footer'",
        'export default function App() {',
        '  return (<div><Footer/></div>)',
        '}',
      ].join('\n'),
    })

    const stub = built['/src/components/Footer.tsx']
    expect(stub).toBeDefined()
    // Must export a NAMED `Footer`, not only a default export — otherwise
    // the named binding stays undefined and the "Element type is invalid"
    // crash reappears despite the module resolving.
    expect(stub).toMatch(/export (const|function) Footer\b/)
  })

  it('still synthesizes a default export stub for a missing sibling imported by default', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import Footer from './components/Footer'",
        'export default function App() { return (<div><Footer/></div>) }',
      ].join('\n'),
    })
    expect(built['/src/components/Footer.tsx']).toContain('export default function Footer')
  })

  it('synthesizes both a default and a named export when different files import the same missing path differently', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import Footer from './components/Footer'",
        "import { Footer as F2 } from './components/Footer'",
        'export default function App() { return (<div><Footer/><F2/></div>) }',
      ].join('\n'),
    })
    const stub = built['/src/components/Footer.tsx']
    expect(stub).toContain('export default function Footer')
    expect(stub).toMatch(/export (const|function) Footer\b/)
  })
})
