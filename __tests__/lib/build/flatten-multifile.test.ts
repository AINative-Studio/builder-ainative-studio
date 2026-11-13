import { describe, it, expect } from 'vitest'
import { parse as babelParse } from '@babel/parser'
import { flattenMultiFile, parseFiles, hasLocalImports } from '@/lib/build/flatten-multifile'
import { detectRootComponent } from '@/lib/component-detector'

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

  it('#1517: inlines a sibling imported via a COMBINED default+named clause (import Hero, { HeroProps } from \'./Hero\')', () => {
    // Real bug: the old regex only matched a BARE default import or a BARE
    // named-only import — never a combined clause on one line, an ordinary
    // shape when a sibling also exports a TS prop-type alongside its default
    // export. The combined form matched neither alternative, so the import
    // was never detected: never inlined, never stubbed by the dangling-
    // import fallback either. stripImportsAndExports() still removed the
    // import LINE from App's code regardless, leaving `<Hero/>` referencing
    // a wholly undeclared identifier — a ReferenceError at render.
    const raw = [
      '// --- FILE: App.tsx ---',
      "import Hero, { HeroProps } from './Hero'",
      'export default function App() { return <Hero/> }',
      '// --- FILE: Hero.tsx ---',
      'export interface HeroProps { title: string }',
      'export default function Hero(props: HeroProps) { return <div>{props.title}</div> }',
    ].join('\n')
    const out = flattenMultiFile(raw)
    expect(out).toContain('function Hero')
    expect(out).toContain('function App')
    expect(out).not.toMatch(/import\s+\w+.*from\s*['"]\.\.?\//)
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

  /**
   * Real bug found live (Dispatch, 2026-09-11, customer-reported): a real
   * generation imported shadcn/ui-style components from '@radix-ui/react-
   * dialog' — a package that genuinely exports Dialog/DialogContent/etc. but
   * NOT Card/CardContent/Button/Label/Input/Separator. The OLD
   * stripImportsAndExports silently deleted the ENTIRE import line
   * unconditionally (same treatment as react/recharts/lucide-react, which
   * really ARE pre-bound globals) — leaving Card/Button/Input/Label/
   * Separator as bare, wholly undeclared identifiers used throughout the
   * JSX. React threw on render; the ErrorBoundary caught it into the
   * degraded "Refining your app" state, and the real UI never painted —
   * confirmed live via browser_validate against the deployed preview
   * (assertion failed: no working UI rendered). This is the customer's
   * exact "basic UI components are missing" report.
   */
  it('stubs named imports from a package NOT actually backed by preview globals (Dispatch/@radix-ui bug)', () => {
    const radixImport = [
      '// --- FILE: src/App.tsx ---',
      "import Header from './components/Header'",
      "import { Card, CardContent, Separator, Button, Dialog, DialogContent, Label, Input } from '@radix-ui/react-dialog'",
      'export default function App(){ return (<div><Header/><Card><CardContent><Input/><Label>Name</Label><Button>Go</Button></CardContent></Card></div>) }',
      '// --- FILE: src/components/Header.tsx ---',
      'export default function Header(){ return <header>H</header> }',
    ].join('\n')
    const out = flattenMultiFile(radixImport)
    // The import line itself must be gone (it would throw — the package
    // really doesn't export these names) — but every name it WOULD have
    // bound must now be a real, defined stub, not silently missing.
    expect(out).not.toMatch(/from\s*['"]@radix-ui\/react-dialog['"]/)
    expect(out).toMatch(/function Card\b/)
    expect(out).toMatch(/function CardContent\b/)
    expect(out).toMatch(/function Button\b/)
    expect(out).toMatch(/function Input\b/)
    expect(out).toMatch(/function Label\b/)
    expect(out).toMatch(/stub:.*@radix-ui\/react-dialog/)
    // A real parse must succeed — no ReferenceError-class failure at runtime.
    expect(() => babelParse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('#1529: stubs a BARE default-only import from a non-backed external package', () => {
    // Real bug: the stub regex only matched an import with a `{...}` named
    // clause — a bare default-only import (no named clause at all) never
    // matched, so it fell through into the generic unconditional
    // import-strip with NO stub generated. <Modal/> became a bare,
    // undeclared identifier in the flattened output.
    const raw = [
      '// --- FILE: App.tsx ---',
      "import Header from './components/Header'",
      "import Modal from 'some-ui-lib'",
      'export default function App(){ return (<div><Header/><Modal>hi</Modal></div>) }',
      '// --- FILE: components/Header.tsx ---',
      'export default function Header(){ return <header>H</header> }',
    ].join('\n')
    const out = flattenMultiFile(raw)
    expect(out).not.toMatch(/from\s*['"]some-ui-lib['"]/)
    expect(out).toMatch(/function Modal\b/)
    expect(out).toMatch(/stub:.*some-ui-lib/)
    expect(() => babelParse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('#1529: stubs BOTH names in a combined default+named import from a non-backed external package', () => {
    const raw = [
      '// --- FILE: App.tsx ---',
      "import Header from './components/Header'",
      "import Icon, { Spinner } from 'some-icon-lib'",
      'export default function App(){ return (<div><Header/><Icon/><Spinner/></div>) }',
      '// --- FILE: components/Header.tsx ---',
      'export default function Header(){ return <header>H</header> }',
    ].join('\n')
    const out = flattenMultiFile(raw)
    expect(out).not.toMatch(/from\s*['"]some-icon-lib['"]/)
    expect(out).toMatch(/function Icon\b/)
    expect(out).toMatch(/function Spinner\b/)
    expect(() => babelParse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('#1529: stubs a bare default-only external import even when App has NO local siblings (single-file-render early-exit path)', () => {
    // A distinct code path from the above: when App imports no local
    // siblings at all, flattenMultiFile() takes an early "single-file
    // render is fine" branch that still calls stripImportsAndExports
    // directly — this exercises that branch, not the multi-file inline() one.
    const raw = [
      '// --- FILE: App.tsx ---',
      "import Modal from 'some-ui-lib'",
      'export default function App(){ return <Modal>hi</Modal> }',
      '// --- FILE: unrelated.tsx ---',
      'export const x = 1',
    ].join('\n')
    const out = flattenMultiFile(raw)
    expect(out).not.toMatch(/from\s*['"]some-ui-lib['"]/)
    expect(out).toMatch(/function Modal\b/)
    expect(() => babelParse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('does NOT stub imports from packages the preview scaffold genuinely backs (react, recharts, lucide-react)', () => {
    const safeImports = [
      '// --- FILE: src/App.tsx ---',
      "import Header from './components/Header'",
      "import React from 'react'",
      "import { BarChart, Bar } from 'recharts'",
      "import { Home, Settings } from 'lucide-react'",
      'export default function App(){ return (<div><Header/><BarChart><Bar/></BarChart></div>) }',
      '// --- FILE: src/components/Header.tsx ---',
      'export default function Header(){ return <header>H</header> }',
    ].join('\n')
    const out = flattenMultiFile(safeImports)
    expect(out).not.toMatch(/from\s*['"]react['"]/)
    expect(out).not.toMatch(/from\s*['"]recharts['"]/)
    expect(out).not.toMatch(/from\s*['"]lucide-react['"]/)
    // No stub function generated for these — the real preview scaffold
    // genuinely provides BarChart/Bar/Home/Settings as pre-bound globals.
    expect(out).not.toMatch(/stub:/)
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

  // Real bug (this loop's overnight comment/string-blindness sweep):
  // parseFiles() matched FILE_MARKER against every RAW line, with no
  // awareness of whether that line sits inside another file's own
  // multi-line block comment or backtick template literal. A docs/API
  // product page demonstrating this exact multi-file convention inside a
  // `/* ... */` comment (no JSDoc `*` margin) or a backtick demo-code
  // string had that embedded line split off as a bogus extra "file",
  // corrupting the real file it belonged to.
  it('a FILE-marker-shaped line nested inside a block comment is not treated as a real marker', () => {
    const raw = [
      '// --- FILE: src/Docs.tsx ---',
      '/*',
      'Example multi-file format:',
      '// --- FILE: src/App.tsx ---',
      'more text',
      '*/',
      'export default function Docs(){ return <div>docs</div> }',
    ].join('\n')
    const files = parseFiles(raw)
    expect(Object.keys(files)).toEqual(['src/Docs.tsx'])
    expect(files['src/Docs.tsx']).toContain('// --- FILE: src/App.tsx ---')
    expect(files['src/Docs.tsx']).toContain('function Docs')
  })

  it('a FILE-marker-shaped line nested inside a multi-line backtick template literal is not treated as a real marker', () => {
    const raw = [
      '// --- FILE: src/Docs.tsx ---',
      'const snippet = `',
      '// --- FILE: src/App.tsx ---',
      "export default function App(){}",
      '`',
      'export default function Docs(){ return <pre>{snippet}</pre> }',
    ].join('\n')
    const files = parseFiles(raw)
    expect(Object.keys(files)).toEqual(['src/Docs.tsx'])
    expect(files['src/Docs.tsx']).toContain('// --- FILE: src/App.tsx ---')
    expect(files['src/Docs.tsx']).toContain('function Docs')
  })

  // Real bug found via static analysis + a direct @babel/core repro (this
  // loop's overnight rendering-correctness sweep): an anonymous default
  // export (`export default function(){}`, `export default () => {}`,
  // `export default class {}`) is just as common a way for a generated
  // sibling component to export itself as the already-handled
  // `export default function Foo(){}` shape. Confirmed two distinct real
  // failure modes, both only reachable through THIS flattener (not the
  // Sandpack multi-file editor path) because the sibling never goes through
  // `lib/component-detector.ts`'s own anonymous-default-export handling on
  // its own — only the single combined blob does, AFTER this file's own
  // (previously unconditional) export-stripping regexes have already run on
  // each child individually:
  //   1. `export default function(){}` / `export default class {}` used to
  //      strip to a bare, nameless `function(){}` / `class {}` STATEMENT —
  //      itself a SyntaxError ("A class name is required" / "Unexpected
  //      token") at the real app/api/preview/[id]/route.ts Babel-transform
  //      step, which the route turns into `window.__BABEL_FAILED__ = true`
  //      and skips rendering entirely — a true blank page. By the time that
  //      route's own `detectRootComponent()` safety net runs on the combined
  //      blob, the literal `export default` text is already gone (mangled
  //      into the invalid bare statement), so it can't catch or fix this.
  //   2. `export default () => {}` (or any other non-identifier expression)
  //      didn't match any stripping regex at all, so the literal `export
  //      default` text survived into the final blob. `detectRootComponent()`
  //      DOES then find it — but as the FIRST (and only) `export default` in
  //      the whole blob, so it silently votes the SIBLING's anonymous export
  //      as the page's root component instead of the real (already-named)
  //      App — the real page layout never renders, just the sibling's
  //      fragment, with no error or blank-page signal at all.
  describe('anonymous default export in a sibling file (no name to bind)', () => {
    it('sibling with `export default function(){}` is named, not left as an invalid bare statement', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import Footer from './Footer'",
        'export default function App(){ return (<div><Footer/></div>) }',
        '// --- FILE: src/Footer.tsx ---',
        'export default function(){ return <footer>F</footer> }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).not.toMatch(/\bfunction\s*\(/) // no nameless function statement
      expect(out).not.toMatch(/export\s+default/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
      // The import's own local binding name is what App's JSX actually uses —
      // naming the sibling anything else would leave <Footer/> unresolved.
      expect(out).toMatch(/function\s+Footer\s*\(/)
    })

    it('sibling with `export default class {}` is named, not left as an invalid bare statement', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import Footer from './Footer'",
        'export default function App(){ return (<div><Footer/></div>) }',
        '// --- FILE: src/Footer.tsx ---',
        'export default class { render(){ return <footer>F</footer> } }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).not.toMatch(/\bclass\s*\{/) // no nameless class statement
      expect(out).not.toMatch(/export\s+default/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
      expect(out).toMatch(/class\s+Footer\b/)
    })

    it('sibling with `export default () => {}` is named, not left as a dangling export statement', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import Footer from './Footer'",
        'export default function App(){ return (<div><h1>Real App</h1><Footer/></div>) }',
        '// --- FILE: src/Footer.tsx ---',
        "export default () => { return <footer>F</footer> }",
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).not.toMatch(/export\s+default/)
      expect(out).toMatch(/const\s+Footer\s*=/)

      // The real regression: before the fix, detectRootComponent() found the
      // sibling's leftover `export default` and voted IT as the page's root
      // component instead of the real App — the actual layout (the <h1>)
      // would never render. Confirm the real App is what gets detected now.
      const detection = detectRootComponent(out)
      expect(detection.name).toBe('App')
      expect(detection.source).toBe('pascalcase-jsx')
    })

    // Real bug found live (#1994): two independent real companies
    // ("tidemark", "driftwood") both hard-failed their /build/{slug}
    // preview with the identical `const AIKitHeader = ;` SyntaxError. A
    // truncated `export default ;` (just a bare trailing semicolon, no real
    // expression — plausible from a generation cut off mid-statement, this
    // repo's established truncation-bug class, #1975 et al.) survives
    // parseFiles' per-file `.trim()` (a trailing `;` isn't whitespace), so
    // the generic fallback's capture (`expr`) comes back as just `";"` with
    // no real expression in it. The old code emitted
    // `const AIKitHeader = ;;\nexport default AIKitHeader;` verbatim — the
    // parser throws "Unexpected token" at the FIRST `;` (right after `=`),
    // reading identically to the reported `const AIKitHeader = ;`.
    it('sibling with a truncated `export default ;` (bare trailing semicolon, no expression) gets a safe no-op stub, not `const X = ;`', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import AIKitHeader from './components/aikit/AIKitHeader'",
        'export default function App(){ return (<div><AIKitHeader/></div>) }',
        '// --- FILE: src/components/aikit/AIKitHeader.tsx ---',
        'export default ;',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).not.toMatch(/=\s*;/) // no `const X = ;`
      expect(out).not.toMatch(/export\s+default/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
      expect(out).toMatch(/function\s+AIKitHeader\s*\(\)\s*\{\s*return\s+null;?\s*\}/)
    })

    it('the entry file itself (App.tsx) with an anonymous default export is named `App`', () => {
      // A lone FILE-marker with no local imports hits flattenMultiFile's
      // documented no-op shortcut (paths.length <= 1) and is intentionally
      // returned unchanged — app/api/preview/[id]/route.ts's OWN
      // detectRootComponent() call already handles a genuinely single-file
      // anonymous default export on its own (there's only one `export
      // default` in the whole blob, so no sibling can be misdetected as the
      // root the way the multi-file case above demonstrates). Covered by
      // this suite's own "single-file input is returned unchanged" test;
      // not re-asserted here.

      // Multi-file path (App has local imports, so it goes through the
      // real appBody = stripImportsAndExports(appCode, 'App') call).
      const multiFile = [
        '// --- FILE: src/App.tsx ---',
        "import Footer from './Footer'",
        'export default () => { return (<div><Footer/></div>) }',
        '// --- FILE: src/Footer.tsx ---',
        'export default function Footer(){ return <footer>F</footer> }',
      ].join('\n')
      const out2 = flattenMultiFile(multiFile)
      expect(out2).not.toMatch(/export\s+default/)
      expect(out2).toMatch(/const\s+App\s*=/)
    })
  })

  describe('sibling exported only via a bare `export { Name }` list, no default export (#1523)', () => {
    // Real bug found this run via static analysis + a direct repro against
    // this file's own exported functions (not yet filed as its own issue —
    // #1523 already tracks exactly this bug class: a naive default-export
    // regex that doesn't recognize a component exported via a bare named
    // `export { Name }` list, already found and fixed in build-files.ts
    // (#1498/#1499), multi-file-parser.ts (#1506/#1507, #1519/#1520), and
    // sandbox-builder.ts (#1515/#1516, #1587/#1588). This is a 4th,
    // previously-unfixed instance in this file's own stripImportsAndExports:
    // none of its export-stripping regexes match a NAMED (non-`default`)
    // export list, so `export { Header }` survives flattening verbatim. The
    // flattened output is injected into a plain, non-module <script> tag by
    // app/api/preview/[id]/route.ts — `export` is not valid syntax there at
    // all, so this throws at the Babel-transform step and the whole preview
    // goes blank, exactly the "blank page" crash class this repo's
    // rendering-correctness effort exists to catch.
    it('a sibling whose only export is `export { Header }` is inlined without leaving export syntax behind', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import { Header } from './components/Header'",
        'export default function App(){ return (<div><Header/></div>) }',
        '// --- FILE: src/components/Header.tsx ---',
        'function Header(){ return <header>Brand</header> }',
        'export { Header }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).not.toMatch(/export\s*\{/)
      expect(out).toMatch(/function\s+Header\s*\(/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
    })

    it('a multi-name bare export list (`export { Header, Footer }`) is stripped for both names', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import { Header, Footer } from './components/Chrome'",
        'export default function App(){ return (<div><Header/><Footer/></div>) }',
        '// --- FILE: src/components/Chrome.tsx ---',
        'function Header(){ return <header>H</header> }',
        'function Footer(){ return <footer>F</footer> }',
        'export { Header, Footer }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).not.toMatch(/export\s*\{/)
      expect(out).toMatch(/function\s+Header\s*\(/)
      expect(out).toMatch(/function\s+Footer\s*\(/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
    })

    it('an aliased bare export (`export { Header as default }`) is stripped, keeping the real declared name', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import Header from './components/Header'",
        'export default function App(){ return (<div><Header/></div>) }',
        '// --- FILE: src/components/Header.tsx ---',
        'function Header(){ return <header>Brand</header> }',
        'export { Header as default }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).not.toMatch(/export\s*\{/)
      expect(out).toMatch(/function\s+Header\s*\(/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
    })
  })

  describe('a demo/example code snippet in a template literal is not mistaken for a real import/export statement', () => {
    // Real bug found this run via static analysis + a direct repro (not yet
    // filed under its own issue number at the time this landed): every
    // regex in this file that strips/rewrites import/export lines is
    // line-anchored (`^...$/gm`) and scans the RAW, unmasked code. An
    // ordinary thing for an API/SDK product's generated landing page to
    // render — a "quickstart" code sample inside a template literal, shown
    // in a <pre>/syntax-highlighter block — can contain lines that are
    // SHAPED like a real import/export statement without being one. Before
    // this fix, stripBareNamedExports/stripImportsAndExports corrupted the
    // middle of that template literal (e.g. silently rewriting its
    // `export { Foo }` demo line), mangling founder-visible example-code
    // content.
    it('an `export { Name }`-shaped line inside a template literal survives untouched', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import Header from './components/Header'",
        'function App(){',
        '  const snippet = `',
        "import Foo from './foo'",
        'export { Foo }',
        '`',
        '  return (<div><Header/><pre>{snippet}</pre></div>)',
        '}',
        'export default App;',
        '// --- FILE: src/components/Header.tsx ---',
        'export default function Header(){ return <header>Brand</header> }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).toMatch(/export \{ Foo \}/)
      expect(out).toMatch(/import Foo from '\.\/foo'/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
    })

    it('an `export default ...`-shaped line inside a template literal is not renamed or stripped', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import Header from './components/Header'",
        'function App(){',
        '  const snippet = `',
        'function Widget() { return null }',
        'export default Widget',
        '`',
        '  return (<div><Header/><pre>{snippet}</pre></div>)',
        '}',
        'export default App;',
        '// --- FILE: src/components/Header.tsx ---',
        'export default function Header(){ return <header>Brand</header> }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      expect(out).toMatch(/export default Widget/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
    })

    it('an `import ... from "./..."`-shaped line inside a template literal is not stripped as a real local import', () => {
      const raw = [
        '// --- FILE: src/App.tsx ---',
        "import Header from './components/Header'",
        'function App(){',
        '  const snippet = `',
        "import Header from './components/Header'",
        '`',
        '  return (<div><Header/><pre>{snippet}</pre></div>)',
        '}',
        'export default App;',
        '// --- FILE: src/components/Header.tsx ---',
        'export default function Header(){ return <header>Brand</header> }',
      ].join('\n')
      const out = flattenMultiFile(raw)
      // The REAL import of Header is inlined (function declaration present);
      // the demo line inside the template literal is preserved verbatim,
      // not stripped as if it were a second, bare top-level import.
      expect(out).toMatch(/function\s+Header\s*\(/)
      expect(out).toMatch(/const snippet = `\nimport Header from '\.\/components\/Header'\n`/)
      expect(() =>
        babelParse(out, { sourceType: 'script', plugins: ['jsx', 'typescript'] }),
      ).not.toThrow()
    })

    it('hasLocalImports is not fooled by a relative-import-shaped line inside a template literal', () => {
      const appCode = [
        'function App(){',
        '  const snippet = `',
        "import Foo from './foo'",
        '`',
        '  return <pre>{snippet}</pre>',
        '}',
      ].join('\n')
      expect(hasLocalImports(appCode)).toBe(false)
    })
  })
})
