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

describe('detectSandpackDependencies (#1097)', () => {
  it('detects lucide-react/recharts usage only in generated (non-builtin) files', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import { Search } from 'lucide-react'\nexport default function App(){ return <Search/> }",
    })
    const { usesLucideReact, usesRecharts } = detectSandpackDependencies(built)
    expect(usesLucideReact).toBe(true)
    expect(usesRecharts).toBe(false)
  })
})

/**
 * Real bugs logged live against #1099 (items 6 and 7) during overnight
 * spot-checks, neither covered by #1122's stubMissingLocalComponents (that
 * fix only patches a broken/missing relative import path — these two are a
 * never-declared npm dependency and malformed syntax the model itself
 * writes, both upstream of any "is this file missing" check).
 */
describe('buildSandpackFiles — react-icons stub + malformed type-import fix (#1099 items 6/7)', () => {
  it('stubs a react-icons import instead of leaving an unresolvable "Cannot find module" dependency', () => {
    const built = buildSandpackFiles({
      '/App.tsx':
        "import { FaRegCircle } from 'react-icons/fa'\nexport default function App(){ return <FaRegCircle/> }",
    })
    const app = built['/App.tsx']
    expect(app).not.toContain("from 'react-icons")
    expect(app).toContain('const FaRegCircle')
  })

  it('stubs multiple named react-icons imports, including an aliased one', () => {
    const built = buildSandpackFiles({
      '/App.tsx':
        "import { FaRegCircle, FaHeart as HeartIcon } from 'react-icons/fa'\nexport default function App(){ return <div><FaRegCircle/><HeartIcon/></div> }",
    })
    const app = built['/App.tsx']
    expect(app).not.toContain("from 'react-icons")
    expect(app).toContain('const FaRegCircle')
    expect(app).toContain('const HeartIcon')
  })

  it('leaves a real lucide-react import untouched (only react-icons is stubbed)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import { Search } from 'lucide-react'\nexport default function App(){ return <Search/> }",
    })
    expect(built['/App.tsx']).toContain("from 'lucide-react'")
  })

  it('fixes a malformed "import type," comma into a valid type-only import', () => {
    const built = buildSandpackFiles({
      '/App.tsx':
        "import type, { Incident } from './types'\nexport default function App(){ return <div/> }",
    })
    expect(built['/App.tsx']).toContain('import type { Incident }')
    expect(built['/App.tsx']).not.toContain('import type,')
  })

  it('does not corrupt a genuinely well-formed "import type { X }" into the malformed comma shape (root cause, not just the jsx-fixer patch)', () => {
    // Real root cause found this run: code-validator.ts's duplicate-import
    // de-dupe (and its sibling local-decl-shadow fix) both mistook the bare
    // `type` keyword for a default-import binding name, so EVERY type-only
    // import -- not just one the model wrote malformed -- got rebuilt into
    // the exact `import type, { X }` shape #1099 item 6 reported live.
    const built = buildSandpackFiles({
      '/App.tsx':
        "import type { Incident } from './types'\nexport default function App(){ return <div/> }",
    })
    expect(built['/App.tsx']).toContain("import type { Incident } from './types'")
    expect(built['/App.tsx']).not.toContain('import type,')
  })

  it('does not corrupt TWO type-only imports in the same file (also would have falsely tripped the duplicate-identifier check on the bare word "type")', () => {
    const built = buildSandpackFiles({
      '/App.tsx':
        "import type { Incident } from './types'\nimport type { Order } from './orders'\nexport default function App(){ return <div/> }",
    })
    const app = built['/App.tsx']
    expect(app).toContain("import type { Incident } from './types'")
    expect(app).toContain("import type { Order } from './orders'")
    expect(app).not.toContain('import type,')
  })
})
