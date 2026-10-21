import { describe, it, expect } from 'vitest'
import { buildSandpackFiles, detectSandpackDependencies } from '@/lib/sandpack/build-files'

/**
 * Real production bug (found live, 2026-10-15, during issue #1089's
 * overnight spot-check loop): the shadcn/AIKit import-injection safety net
 * always prepended './components/ui/X' (and './components/aikit') to a
 * generated file missing an import for a used component — correct for a
 * file at /App.tsx, but wrong for any file already living inside
 * /src/components/ or /components/ (the common shape for a real multi-file
 * app's sub-components), where it resolves to the nonexistent
 * .../components/components/ui/X and crashes Sandpack with "Cannot find
 * module". Confirmed across multiple real Builder apps (e.g. a "Wallify"
 * app's CollectionManager.tsx/WallGrid.tsx) via the sandpack-bundler's own
 * real error events, not a synthetic repro.
 */
describe('buildSandpackFiles — shadcn/AIKit import-injection path correctness (#1089)', () => {
  it('injects a root-relative shadcn import for a file at /App.tsx', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <Button>hi</Button> }",
    })
    expect(built['/App.tsx']).toContain("from './components/ui/button'")
  })

  it('injects a sibling-relative shadcn import for a file inside /src/components/ (the real bug)', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': "import Sidebar from './components/Sidebar'\nexport default function App(){ return <Sidebar/> }",
      '/src/components/Sidebar.tsx': "export default function Sidebar(){ return <Button>hi</Button> }",
    })
    const sidebar = built['/src/components/Sidebar.tsx']
    expect(sidebar).toContain("from './ui/button'")
    expect(sidebar).not.toContain("from './components/ui/button'")
  })

  it('injects a sibling-relative shadcn import for a file inside /components/ (root-style apps)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import Sidebar from './components/Sidebar'\nexport default function App(){ return <Sidebar/> }",
      '/components/Sidebar.tsx': "export default function Sidebar(){ return <Input/> }",
    })
    const sidebar = built['/components/Sidebar.tsx']
    expect(sidebar).toContain("from './ui/input'")
    expect(sidebar).not.toContain("from './components/ui/input'")
  })

  it('injects a sibling-relative AIKit import for a file inside /src/components/', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': "import Dash from './components/Dash'\nexport default function App(){ return <Dash/> }",
      '/src/components/Dash.tsx': "export default function Dash(){ return <MetricCard/> }",
    })
    const dash = built['/src/components/Dash.tsx']
    expect(dash).toContain("from './aikit'")
    expect(dash).not.toContain("from './components/aikit'")
  })

  it('still resolves to a real file on disk for the sibling-relative shadcn import (no dangling import)', () => {
    const built = buildSandpackFiles({
      '/src/components/Sidebar.tsx': "export default function Sidebar(){ return <Separator/> }",
    })
    // getBuiltinFiles() duplicates every shadcn builtin into /src/components/ui/*
    // too — the injected './ui/separator' from /src/components/Sidebar.tsx
    // must resolve to exactly that file.
    expect(built['/src/components/ui/separator.tsx']).toBeDefined()
  })

  it('injects CircleDot from lucide-react when used (confirmed live 2026-10-15 — real app used it, was missing from the safety-net icon list, verified CircleDot exists in the pinned lucide-react@0.344.0)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <CircleDot/> }",
    })
    expect(built['/App.tsx']).toContain("from 'lucide-react'")
    expect(built['/App.tsx']).toMatch(/import\s*\{[^}]*\bCircleDot\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
  })

  it('merges a missing lucide icon into an EXISTING lucide-react import rather than skipping injection entirely (confirmed live 2026-10-15 — real app imported Tag but used Shield as a value, not JSX, in an object literal)', () => {
    const built = buildSandpackFiles({
      '/App.tsx':
        "import { Tag } from 'lucide-react'\nimport React from 'react'\nconst items = [{ icon: Shield }]\nexport default function App(){ return <Tag/> }",
    })
    const app = built['/App.tsx']
    // Previously: the whole lucide injection was skipped because the file
    // ALREADY had a lucide-react import (just not a complete one) — Shield
    // never got added, and Sandpack crashed with "Shield is not defined".
    expect(app).toMatch(/import\s*\{[^}]*\bShield\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
    // Tag must still be there too — merging must not drop the existing icon.
    expect(app).toMatch(/import\s*\{[^}]*\bTag\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
    // Only ONE lucide-react import statement — not a duplicate second one.
    expect(app.match(/from\s*['"]lucide-react['"]/g)?.length).toBe(1)
  })

  it('rewrites a MODEL-AUTHORED (not injected) wrong-depth components/ import to the correct relative depth (confirmed live 2026-10-15 — two real apps, "Wallify"\'s Hero.tsx and a second real app\'s Header.tsx, both crashed with "Cannot find module \'/components/components/aikit\'")', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import Header from './components/Header'\nexport default function App(){ return <Header/> }",
      '/components/Header.tsx':
        "import { MetricCard } from './components/aikit'\nimport { Button } from './components/ui/button'\nexport default function Header(){ return <div><Button/><MetricCard/></div> }",
    })
    const header = built['/components/Header.tsx']
    expect(header).toContain("from './aikit'")
    expect(header).toContain("from './ui/button'")
    expect(header).not.toContain("from './components/aikit'")
    expect(header).not.toContain("from './components/ui/button'")
  })

  it('leaves a model-authored components/ import UNCHANGED when the file is already at the correct depth (root level)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import { MetricCard } from './components/aikit'\nexport default function App(){ return <MetricCard/> }",
    })
    expect(built['/App.tsx']).toContain("from './components/aikit'")
  })
})

/**
 * Real production bug (#1165, found live on habanero-hub): the shadcn and
 * lucide-react import-injection safety nets both matched a component/icon
 * NAME as a bare word anywhere in the file — including plain English prose,
 * JSX text content, object keys, and unrelated string literals with zero
 * connection to an actual usage. Confirmed live: habanero-hub's real copy
 * ("Select mild, medium, or wild", "Gift Subscriptions" link text, a
 * "Jalapeño Sunrise" flavor name, a "Navigation" JSX comment, "Content-Type"
 * header strings, "Key features"/"Reorder & Share" copy) spuriously injected
 * `Select` (shadcn) and `Gift`/`Key`/`Navigation`/`Share`/`Sunrise`/`Type`
 * (lucide-react) into the generated file, none of them ever actually
 * rendered. Both injections now require a real usage signal: a JSX tag
 * (`<Component`) for shadcn, or a JSX tag OR the documented `icon: Icon` /
 * `icon={Icon}` object-property-reference pattern for lucide-react icons
 * (the AIKit injection a few lines above never had this bug — it already
 * required the strict JSX-tag pattern only).
 */
describe('buildSandpackFiles — import-injection false positives on prose/text content (#1165)', () => {
  it('does NOT inject a shadcn import when the component name only appears as plain text, not JSX', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <p>Select mild, medium, or wild</p> }",
    })
    expect(built['/App.tsx']).not.toContain("from './components/ui/select'")
  })

  it('DOES inject a shadcn import when the component is genuinely used as a JSX tag', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <Select><SelectTrigger/></Select> }",
    })
    expect(built['/App.tsx']).toContain("from './components/ui/select'")
  })

  it('does NOT inject lucide-react icons that only appear as prose/text/unrelated identifiers', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `export default function App(){
        return <div>
          <a href="#">Gift Subscriptions</a>
          <p>Key features and benefits</p>
          {/* Navigation */}
          <p>Jalapeño Sunrise</p>
          <p>Reorder & Share</p>
        </div>
      }`,
    })
    const app = built['/App.tsx']
    // The real page CONTENT ("Gift Subscriptions", "Jalapeño Sunrise", etc.)
    // legitimately stays — only a spurious lucide-react import is the bug.
    expect(app).not.toMatch(/\{[^}]*\bGift\b[^}]*\}\s*from\s*'lucide-react'/)
    expect(app).not.toMatch(/\{[^}]*\bNavigation\b[^}]*\}\s*from\s*'lucide-react'/)
    expect(app).not.toMatch(/\{[^}]*\bSunrise\b[^}]*\}\s*from\s*'lucide-react'/)
    expect(app).not.toMatch(/\{[^}]*\bShare\b[^}]*\}\s*from\s*'lucide-react'/)
  })

  it('DOES inject a lucide-react icon used as a real JSX tag', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <Flame/> }",
    })
    expect(built['/App.tsx']).toMatch(/import\s*\{[^}]*\bFlame\b[^}]*\}\s*from\s*'lucide-react'/)
  })

  it('DOES inject a lucide-react icon used via the documented icon-property pattern (icon: Icon)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "const items = [{ icon: Flame, title: 'Hot' }]\nexport default function App(){ return <div>{items[0].title}</div> }",
    })
    expect(built['/App.tsx']).toMatch(/import\s*\{[^}]*\bFlame\b[^}]*\}\s*from\s*'lucide-react'/)
  })

  it('DOES inject a lucide-react icon used via icon={Icon}', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "function Row({icon}){ return null }\nexport default function App(){ return <Row icon={Flame}/> }",
    })
    expect(built['/App.tsx']).toMatch(/import\s*\{[^}]*\bFlame\b[^}]*\}\s*from\s*'lucide-react'/)
  })

  it('reproduces the real habanero-hub false-positive case end to end: Select/Gift/Key/Navigation/Share/Sunrise/Type all absent, the model-intended icons preserved', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `import { Flame, Package, Star, Truck, Shield, TrendingUp, Check, ArrowRight, Mail, MapPin, Phone } from 'lucide-react'
import { MetricCard } from './components/aikit'
export default function App() {
  return (
    <div>
      <p>Select mild, medium, or wild—we match you with sauces that fit your spice tolerance.</p>
      <li><a href="#">Gift Subscriptions</a></li>
      <p aria-label="Key features and benefits">Features</p>
      {/* Navigation */}
      <p>Jalapeño Sunrise</p>
      <p>Reorder & Share</p>
      <MetricCard title="Small-Batch Makers" value="47+" />
      <Flame />
    </div>
  )
}`,
    })
    const app = built['/App.tsx']
    expect(app).not.toContain("from './components/ui/select'")
    const lucideImportLine = app.match(/import\s*\{[^}]*\}\s*from\s*'lucide-react'/)?.[0] ?? ''
    for (const falsePositive of ['Gift', 'Key', 'Navigation', 'Sunrise', 'Type']) {
      expect(lucideImportLine).not.toMatch(new RegExp(`\\b${falsePositive}\\b`))
    }
    expect(lucideImportLine).toContain('Flame')
  })
})

/**
 * Real production bug (#1165 follow-up, found live on habanero-hub AFTER the
 * import-injection false-positive fix above): stubMissingLocalComponents's
 * own existence check for a relative import only tried the extension
 * candidates `.tsx`, `.ts`, and `/index.tsx` — never `/index.ts`. The real
 * AIKit builtin module lives at /components/aikit/index.ts (a plain .ts
 * file). A genuine `import { MetricCard } from './components/aikit'` was
 * therefore treated as missing and got a conflicting inert stub synthesized
 * at /components/aikit.tsx (default-export-only, no MetricCard), which then
 * won module resolution over the real directory module — MetricCard resolved
 * to undefined and crashed the whole preview with "Element type is invalid".
 */
describe('buildSandpackFiles — stubMissingLocalComponents must recognize a real .ts index module (#1165 follow-up)', () => {
  it('does NOT synthesize a conflicting stub for a real AIKit import already satisfied by the builtin /components/aikit/index.ts', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import { MetricCard } from './components/aikit'\nexport default function App(){ return <MetricCard title=\"x\" value=\"1\" /> }",
    })
    expect(built['/components/aikit.tsx']).toBeUndefined()
    expect(built['/components/aikit/index.ts']).toBeDefined()
  })

  it('still stubs a genuinely missing relative import (no real file at any candidate extension)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import Footer from './components/Footer'\nexport default function App(){ return <Footer/> }",
    })
    expect(built['/components/Footer.tsx']).toContain('Auto-stubbed')
  })
})

describe('detectSandpackDependencies (#1097)', () => {
  it('detects lucide-react/recharts usage only in generated (non-builtin) files', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import { Search } from 'lucide-react'\nexport default function App(){ return <Search/> }",
    })
    const { usesLucideReact, usesRecharts } = detectSandpackDependencies(built)
    expect(usesLucideReact).toBe(true)
    expect(usesRecharts).toBe(false)
  })

  describe('usesStripeJs (#1164 — ZeroCommerce checkout UI)', () => {
    it('detects @stripe/stripe-js usage in generated code', () => {
      const built = buildSandpackFiles({
        '/App.tsx': "import { loadStripe } from '@stripe/stripe-js'\nexport default function App(){ return null }",
      })
      const { usesStripeJs } = detectSandpackDependencies(built)
      expect(usesStripeJs).toBe(true)
    })

    it('detects @stripe/react-stripe-js usage in generated code', () => {
      const built = buildSandpackFiles({
        '/Checkout.tsx': "import { Elements, PaymentElement } from '@stripe/react-stripe-js'\nexport default function Checkout(){ return null }",
      })
      const { usesStripeJs } = detectSandpackDependencies(built)
      expect(usesStripeJs).toBe(true)
    })

    it('is false when the generated app has no Stripe import at all', () => {
      const built = buildSandpackFiles({
        '/App.tsx': "export default function App(){ return <div>hello</div> }",
      })
      const { usesStripeJs } = detectSandpackDependencies(built)
      expect(usesStripeJs).toBe(false)
    })
  })
})
