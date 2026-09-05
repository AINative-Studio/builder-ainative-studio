import { describe, it, expect } from 'vitest'
import { parse as babelParse } from '@babel/parser'
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

  // builder#499: register-app rejected genuinely valid, successfully-generated
  // apps with a 422 generation_failed/syntax_error, citing a flattened-parse
  // error at a specific location (e.g. (47:37)) — but a manual reconstruction
  // of the same code from the SSE stream (raw FILE-marker text, no fences)
  // reproduced no error, leaving the root cause unconfirmed.
  //
  // Root cause: app/api/chat-ws/route.ts's storePreview() call wraps the
  // served code in a markdown fence before writing it to the in-memory
  // preview store —
  //   const cleanCodeResponse = `\`\`\`jsx\n${finalContent}\n\`\`\``
  //   storePreview(responseId, cleanCodeResponse, ...)
  // — and lib/build/ready-gate.ts's resolveStoredApp() reads that in-memory
  // store FIRST (before the durable ZeroDB copy, which persists the UNfenced
  // finalContent instead — a genuine two-path divergence). So the real
  // stored.code the ready-gate parses is routinely the FENCED string, not the
  // bare `// --- FILE: ---` blob a manual reconstruction from the SSE stream
  // would produce. parseFiles() had no concept of code fences: it only splits
  // on FILE-marker lines, so the closing ``` was silently appended as a
  // trailing line of whichever file happened to be LAST in the blob — which
  // then parses as an unterminated template literal once flattened, at
  // whatever line/column the stray backticks land on (matching the exact
  // "flattened-parse error at a specific location" symptom).
  it('a markdown-fenced multi-file blob (the real shape read back from the in-memory preview store) still parses cleanly', () => {
    const fenced = '```jsx\n' + multi + '\n```'

    // Before the fix this call threw "Unterminated template" because the
    // closing ``` fence landed inside Hero.tsx's body (the last file).
    const files = parseFiles(fenced)
    expect(Object.keys(files).length).toBe(3)
    expect(files['src/components/Hero.tsx']).not.toContain('```')

    const flat = flattenMultiFile(fenced)
    expect(() =>
      babelParse(flat, { sourceType: 'module', plugins: ['jsx', 'typescript'] }),
    ).not.toThrow()
  })

  it('a bare (unlabeled) ``` fence around a multi-file blob is stripped the same way', () => {
    const fenced = '```\n' + multi + '\n```'
    const flat = flattenMultiFile(fenced)
    expect(() =>
      babelParse(flat, { sourceType: 'module', plugins: ['jsx', 'typescript'] }),
    ).not.toThrow()
  })

  it('a stray ``` that is NOT a wrapping fence (e.g. inside JSX text) is left untouched', () => {
    const withInlineBackticks = [
      '// --- FILE: src/App.tsx ---',
      'export default function App(){ return <div>`inline` text</div> }',
    ].join('\n')
    const files = parseFiles(withInlineBackticks)
    expect(files['src/App.tsx']).toContain('`inline`')
  })
})
