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
