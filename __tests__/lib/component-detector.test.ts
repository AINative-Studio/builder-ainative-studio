import { describe, it, expect } from 'vitest'
import {
  detectRootComponent,
  ANON_DEFAULT_NAME,
  KNOWN_PAGE_NAMES,
} from '@/lib/component-detector'

/**
 * builder#82 — robust root-component detection for the preview runtime.
 *
 * The preview iframe showed "Component Not Found" whenever a generated app named
 * its root component something outside a hardcoded list, or only `export default`ed
 * an anonymous component. These tests pin the new priority order:
 *   1. identified default export  2. anonymous default export (with rewrite)
 *   3. PascalCase JSX-returning component  4. known-name tiebreaker  else null.
 */
describe('detectRootComponent', () => {
  describe('priority 1 — identified default export (any name)', () => {
    it('detects `export default function CustomName`', () => {
      const code = `
        function Helper() { return null }
        export default function InvoiceWizard() {
          return (<div>hi</div>)
        }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('InvoiceWizard')
      expect(r.source).toBe('default-export-named')
      expect(r.rewrite).toBeUndefined()
    })

    it('detects `export default class CustomName`', () => {
      const code = `
        export default class GalaxyMap extends React.Component {
          render() { return <div /> }
        }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('GalaxyMap')
      expect(r.source).toBe('default-export-named')
    })

    it('detects `export default Name` bare reference to a defined const', () => {
      const code = `
        const WeatherWidget = () => <div>weather</div>
        export default WeatherWidget
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('WeatherWidget')
      expect(r.source).toBe('default-export-named')
    })

    it('#1536: falls through past React.memo(Foo) instead of false-capturing "React" as the component name', () => {
      // Real bug: [A-Z]\w* greedily matched just "React" ('.' isn't a \w
      // char), and isPascalCase('React') is true, so this used to return
      // { name: 'React' } immediately — a confident WRONG answer (React is
      // the imported namespace, not a component) that never fell through to
      // priority 3's real PascalCase/JSX scan, which finds the actual
      // component (Dashboard). The runtime then tried to render the React
      // namespace object as the root component.
      const code = `
        import React from "react";
        function Dashboard() {
          return (<div>Hello</div>);
        }
        export default React.memo(Dashboard);
      `
      const r = detectRootComponent(code)
      expect(r.name).not.toBe('React')
      expect(r.name).toBe('Dashboard')
    })

    it('#1536: falls through past React.forwardRef(Foo) the same way', () => {
      const code = `
        import React from "react";
        const Widget = (props, ref) => <div ref={ref}>hi</div>;
        export default React.forwardRef(Widget);
      `
      const r = detectRootComponent(code)
      expect(r.name).not.toBe('React')
    })

    it('#1536: still detects a genuine bare-reference default export (no regression)', () => {
      const code = `
        function Foo() { return <div>foo</div> }
        export default Foo;
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Foo')
      expect(r.source).toBe('default-export-named')
    })

    it('prefers the default export over PascalCase / known names', () => {
      // Both a Dashboard (known name) and a default export exist — default wins.
      const code = `
        function Dashboard() { return <div>dash</div> }
        export default function Zephyr() { return <main>z</main> }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Zephyr')
      expect(r.source).toBe('default-export-named')
    })

    it('detects a renamed default export via a named-export list: `export { Dashboard as default }`', () => {
      // Real bug: none of the `export default ...` regexes above match this
      // shape at all (no literal `export default` text), so detection fell
      // through entirely to priority 3's PascalCase/JSX scan — which has no
      // way to know Dashboard (not Footer) is the real default, and just
      // picks whichever matching declaration is LAST in source order. Here
      // that's the wrong one: Footer is a later, non-default helper/section
      // component, never marked as default anywhere.
      const code = `
        function Dashboard() { return (<div>dash</div>) }
        function Footer() { return (<div>footer</div>) }
        export { Dashboard as default }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Dashboard')
      expect(r.source).toBe('default-export-named')
    })

    it('detects a renamed default export alongside other named siblings in the same list', () => {
      const code = `
        function Header() { return (<div>header</div>) }
        function Dashboard() { return (<div>dash</div>) }
        export { Header, Dashboard as default }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Dashboard')
      expect(r.source).toBe('default-export-named')
    })

    it('does not misfire on an ordinary named-export list with no `as default` alias', () => {
      const code = `
        function Dashboard() { return (<div>dash</div>) }
        function Footer() { return (<div>footer</div>) }
        export { Dashboard, Footer }
      `
      const r = detectRootComponent(code)
      // No explicit default marker — falls through to priority 3's
      // last-defined heuristic, same as before this fix.
      expect(r.name).toBe('Footer')
      expect(r.source).toBe('pascalcase-jsx')
    })
  })

  describe('priority 1.5 — component declared inline inside memo()/forwardRef() (#1615)', () => {
    it('detects an anonymous arrow declared inline inside React.memo() and emits a binding rewrite', () => {
      const code = `export default React.memo(() => {\n  return <div>x</div>\n});`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      expect(r.rewrite).toBeDefined()
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`const ${ANON_DEFAULT_NAME} = React.memo(`)
      expect(rewritten).not.toMatch(/export\s+default/)
    })

    it('detects an anonymous (props, ref) arrow declared inline inside forwardRef() and emits a binding rewrite', () => {
      const code = `export default forwardRef((props, ref) => {\n  return <div ref={ref}>x</div>\n});`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`const ${ANON_DEFAULT_NAME} = forwardRef(`)
      expect(rewritten).not.toMatch(/export\s+default/)
    })

    it('detects a named function expression declared inline inside memo(), with a name NOT on KNOWN_PAGE_NAMES', () => {
      // Deliberately a name absent from KNOWN_PAGE_NAMES — a name like
      // "Dashboard" would be accidentally "rescued" by priority 4's
      // tiebreaker and mask this bug, same pitfall #1611's test suite flags.
      const code = `export default memo(function WrenchHub() {\n  return <div>x</div>\n});`
      const r = detectRootComponent(code)
      expect(r.name).toBe('WrenchHub')
      expect(r.source).toBe('default-export-named')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain('const WrenchHub = memo(function WrenchHub(')
      expect(rewritten).not.toMatch(/export\s+default/)
    })

    it('detects a named function expression declared inline inside forwardRef()', () => {
      const code = `export default forwardRef(function WrenchHub(props, ref) {\n  return <div ref={ref}>x</div>\n});`
      const r = detectRootComponent(code)
      expect(r.name).toBe('WrenchHub')
      expect(r.source).toBe('default-export-named')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain('const WrenchHub = forwardRef(function WrenchHub(')
    })

    it('still falls through to priority 3 for a bare reference wrapped in memo() (no regression)', () => {
      const code = `
        import React from "react";
        function Dashboard() {
          return (<div>Hello</div>);
        }
        export default React.memo(Dashboard);
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Dashboard')
      expect(r.rewrite).toBeUndefined()
    })
  })

  describe('priority 2 — anonymous default export (needs rewrite)', () => {
    it('detects `export default function () {}` and emits a binding rewrite', () => {
      const code = `export default function() {\n  return <div>anon</div>\n}`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      expect(r.rewrite).toBeDefined()
      // Applying the rewrite must yield valid, bindable source (no anon statement).
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`function ${ANON_DEFAULT_NAME}(`)
      expect(rewritten).not.toMatch(/export\s+default\s+function\s*\(/)
    })

    it('detects `export default () => (...)` arrow and rewrites to a named const', () => {
      const code = `export default () => (\n  <section>arrow</section>\n)`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`const ${ANON_DEFAULT_NAME} = `)
      expect(rewritten).not.toMatch(/export\s+default/)
    })

    it('detects `export default (props) => ...` with params', () => {
      const code = `export default (props) => <div>{props.title}</div>`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.rewrite).toBeDefined()
    })

    it('detects anonymous `export default class {}`', () => {
      const code = `export default class {\n  render() { return <div/> }\n}`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`class ${ANON_DEFAULT_NAME} {`)
    })

    it('#1524: detects anonymous `export default class extends React.Component {}` (dotted extends target)', () => {
      // Real bug: the extends-target group only allowed \w+ (a single
      // identifier), so a DOTTED base class never matched at all — an
      // extremely common real-world shape. With no match, detection fell
      // through this priority entirely, and since there's no PascalCase
      // declaration for a genuinely anonymous class, priority 3 found
      // nothing either — the function returned { name: null, source: 'none'
      // }, "no renderable component," even though a real one exists.
      const code = `export default class extends React.Component {\n  render() { return <div/> }\n}`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`class ${ANON_DEFAULT_NAME} extends React.Component {`)
    })

    it('#1524: still detects anonymous `export default class extends Component {}` (plain identifier extends target)', () => {
      const code = `export default class extends Component {\n  render() { return <div/> }\n}`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
    })

    it('#1619: detects an anonymous arrow whose destructured param has a call-expression default', () => {
      // Real bug: the old flat `[^)]*` scan for the param list could not
      // cross the `)` closing `getDefaultItems()` — a `)` INSIDE the param
      // list — so the regex never matched at all. With no name declared
      // anywhere else in the file (genuinely anonymous), priority 3 found
      // nothing either, so this returned { name: null, source: 'none' }.
      const code = `export default ({ items = getDefaultItems() }) => { return (<div>{items}</div>); }`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`const ${ANON_DEFAULT_NAME} = `)
      expect(rewritten).not.toMatch(/export\s+default/)
    })

    it('#1619: detects an anonymous arrow with a nested-destructure call-expression default', () => {
      const code = `export default ({ pair: [a, b] = getPair() }) => { return (<div>{a}{b}</div>); }`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
    })

    it('#1619: detects an anonymous async arrow with a call-expression default (depth-count + async group together)', () => {
      const code = `export default async ({ data = fetchDefault() }) => { return (<div>{data}</div>); }`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
    })

    it('#1619: no regression — a function-type param (`() => void`) still resolves correctly', () => {
      // This shape already worked before #1619 (the rewrite only ever swaps
      // the fixed "export default " prefix, never the regex's full match
      // span), but it's the sibling case that motivated checking this fix
      // doesn't change its outcome.
      const code = `export default (handler: () => void) => { return (<div onClick={handler}>x</div>); }`
      const r = detectRootComponent(code)
      expect(r.name).toBe(ANON_DEFAULT_NAME)
      expect(r.source).toBe('default-export-anonymous')
      const rewritten = code.replace(r.rewrite!.find, r.rewrite!.replace)
      expect(rewritten).toContain(`const ${ANON_DEFAULT_NAME} = `)
      expect(rewritten).not.toMatch(/export\s+default/)
    })

    it('#1619: a genuinely unbalanced/malformed param list still falls through honestly (no false match)', () => {
      const code = `export default ({ broken = foo( }) => { return <div/> }`
      const r = detectRootComponent(code)
      expect(r.name).toBeNull()
      expect(r.source).toBe('none')
    })
  })

  describe('priority 3 — PascalCase component returning JSX (no default export)', () => {
    it('detects a custom-named function component not on the hardcoded list', () => {
      const code = `
        function NebulaConsole() {
          return (
            <div className="console">nebula</div>
          )
        }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('NebulaConsole')
      expect(r.source).toBe('pascalcase-jsx')
    })

    it('detects a custom-named arrow-const component', () => {
      const code = `const QuasarBoard = () => {\n  return <div>quasar</div>\n}`
      const r = detectRootComponent(code)
      expect(r.name).toBe('QuasarBoard')
      expect(r.source).toBe('pascalcase-jsx')
    })

    it('picks the LAST-defined JSX component (root is conventionally last)', () => {
      const code = `
        function Header() { return <header>h</header> }
        function Footer() { return <footer>f</footer> }
        function PulsarApp() { return <div><Header /><Footer /></div> }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('PulsarApp')
    })

    it('skips known library / icon / AIKit names when scanning', () => {
      // Button (shadcn) and MetricCard (AIKit) must be skipped; Cosmos wins.
      const code = `
        const Button = () => <button>x</button>
        const MetricCard = () => <div>m</div>
        function Cosmos() { return <div>cosmos</div> }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Cosmos')
    })

    it('does NOT pick a lowercase helper (not PascalCase)', () => {
      const code = `
        const useThing = () => { return 1 }
        function Aurora() { return <div>aurora</div> }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Aurora')
    })

    // DropdownMenu/ScrollArea are real shadcn exports that had drifted out
    // of this module's own NON_ROOT_NAMES skip-set (same root-cause class as
    // #1277/#1278/#1281) -- a local stub redeclaration of one of them could
    // otherwise be mistaken for the app's actual root component.
    it('skips a locally-redeclared DropdownMenu/ScrollArea stub when scanning', () => {
      const code = `
        const DropdownMenu = ({ children }) => <div>{children}</div>
        const ScrollArea = ({ children }) => <div className="overflow-auto">{children}</div>
        function Orbit() { return <div>orbit</div> }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('Orbit')
    })

    // Real bug found via an overnight static-analysis sweep: a root component
    // declared with an explicit TS type annotation (e.g. `: React.FC<Props>`)
    // was invisible to the old `const\s+([A-Z]\w*)\s*=` regex, which required
    // `=` immediately after the name. When such a component is exported only
    // via a bare `export { Name }` list (no `export default`, so priorities
    // 1/2 never fire), detection used to fall all the way through to
    // `{name: null}` — the same "Element type is invalid" crash class this
    // module's whole fix history exists to prevent.
    it('detects a TS-typed arrow-const component (React.FC<Props> annotation), bare export list', () => {
      const code = `
        import React from 'react'
        const WrenchHub: React.FC<{}> = () => {
          return (<div>hub</div>)
        }
        export { WrenchHub }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('WrenchHub')
      expect(r.source).toBe('pascalcase-jsx')
    })

    it('detects a TS-typed arrow-const component with a bare FC annotation (no namespace, no generic)', () => {
      const code = `
        import { FC } from 'react'
        const QuartzPanel: FC = () => {
          return <div>quartz</div>
        }
        export { QuartzPanel }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('QuartzPanel')
    })

    it('still picks the LAST-defined JSX component when earlier siblings are TS-typed', () => {
      const code = `
        const Header: React.FC<{}> = () => { return <header>h</header> }
        const Footer: React.FC<{}> = () => { return <footer>f</footer> }
        const GalaxyApp: React.FC<{}> = () => { return (<div><Header /><Footer /></div>) }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('GalaxyApp')
    })

    it('a preceding sibling with a function-type annotation does not confuse detection of the typed root component', () => {
      // A sibling `const` with a function-type annotation (`: () => void`,
      // containing a real `=` inside `=>`) is deliberately NOT matched by the
      // narrowed type-annotation group (it only tolerates an identifier/
      // dotted-generic type, not an arrow-type) — confirming the fix doesn't
      // use a greedy `[^=]+` that could mis-scan past it, and that the real
      // typed root component right after is still found correctly.
      const code = `
        const onReady: () => void = () => {}
        const CometPage: React.FC<{}> = () => { return <div>comet</div> }
      `
      const r = detectRootComponent(code)
      expect(r.name).toBe('CometPage')
    })
  })

  describe('priority 4 — known-name tiebreaker', () => {
    it('falls back to a known name when no default & no JSX detected', () => {
      // Dashboard is declared but the body has no detectable JSX return — the
      // known-name list still resolves it as a last resort.
      const code = `function Dashboard() { const x = 1; return x }`
      const r = detectRootComponent(code)
      expect(r.name).toBe('Dashboard')
      // Either resolved by pascalcase fallback or known-name — both acceptable,
      // but it MUST resolve, not fail.
      expect(['known-name', 'pascalcase-jsx']).toContain(r.source)
    })

    it('weak-guesses the last PascalCase decl when no JSX & not a known name', () => {
      // Custom name, not on the list, and no detectable JSX return — rather than a
      // hard "Component Not Found", the last PascalCase declaration is guessed
      // (the runtime still wraps it in an ErrorBoundary).
      const code = `function ZorpWidget() { const n = 42; return n }`
      const r = detectRootComponent(code)
      expect(r.name).toBe('ZorpWidget')
      expect(r.source).toBe('pascalcase-jsx')
    })

    it('KNOWN_PAGE_NAMES still contains the historical names (no regression)', () => {
      expect(KNOWN_PAGE_NAMES).toContain('Dashboard')
      expect(KNOWN_PAGE_NAMES).toContain('App')
      expect(KNOWN_PAGE_NAMES).toContain('LandingPage')
      expect(KNOWN_PAGE_NAMES).toContain('TodoList')
    })
  })

  describe('genuinely empty / non-component input → name null', () => {
    it('returns null for empty string', () => {
      expect(detectRootComponent('').name).toBeNull()
      expect(detectRootComponent('   ').name).toBeNull()
    })

    it('returns null when there is no component at all (only data/helpers)', () => {
      const code = `
        const config = { theme: 'dark' }
        function addNumbers(a, b) { return a + b }
        const total = addNumbers(1, 2)
      `
      const r = detectRootComponent(code)
      expect(r.name).toBeNull()
      expect(r.source).toBe('none')
    })

    it('returns null for a truncated blob with no component declaration', () => {
      const code = `import React from 'react'\n// generation was cut off here`
      const r = detectRootComponent(code)
      expect(r.name).toBeNull()
    })
  })

  describe('regression — existing working apps still resolve', () => {
    it('hardcoded-name app with default export resolves to its name', () => {
      const code = `export default function Dashboard() { return <div>ok</div> }`
      expect(detectRootComponent(code).name).toBe('Dashboard')
    })

    it('plain `function App()` (no export) resolves', () => {
      const code = `function App() { return <div>app</div> }`
      expect(detectRootComponent(code).name).toBe('App')
    })
  })
})
