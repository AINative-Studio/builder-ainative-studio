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
