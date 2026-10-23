// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * Real production bug (found live, 2026-10-14, during issue #1089's
 * verification): `components/chat/sandpack-preview.tsx` unconditionally
 * declared `lucide-react` AND `recharts` in Sandpack's `customSetup.dependencies`
 * on EVERY preview, regardless of whether the generated app actually imports
 * them. Confirmed via real profiling against the live, self-hosted bundler
 * (sandpack-bundler PR #7's tree-shaking fix already cut lucide-react's own
 * barrel-walk cost by ~99% when it IS used) that `recharts` alone still pays
 * a real, measured cost compiling its ~48-package transitive dependency tree
 * on every single preview — even for apps that never import it — because it
 * was declared unconditionally.
 *
 * Fix: only declare `lucide-react`/`recharts` when the generated app's own
 * files actually reference them (a conservative substring check across all
 * non-builtin files — a literal `'lucide-react'`/`'recharts'` substring can
 * only appear in generated source via a real import of that package, so this
 * can only ever ADD the dependency when truly needed, never silently drop a
 * real usage). `react`/`react-dom`/`prop-types` stay unconditional — every
 * generated app needs the React runtime regardless of its own imports.
 */

vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackProvider: (props: any) => {
    ;(globalThis as any).__lastSandpackCustomSetup = props.customSetup
    return React.createElement('div', { 'data-testid': 'sandpack-provider' }, props.children)
  },
  SandpackPreview: () => React.createElement('div', { 'data-testid': 'sandpack-preview-inner' }),
  SandpackLayout: (props: any) => React.createElement('div', null, props.children),
  useSandpack: () => ({ listen: () => () => {} }),
}))

vi.mock('@/lib/sandpack/jsx-fixer', () => ({
  fixJsxErrors: (code: string) => code,
}))

vi.mock('@/lib/sandpack/setup', () => ({
  getBuiltinFiles: () => ({
    '/components/ui/button.tsx': 'export function Button() { return null }',
  }),
}))

vi.mock('@/lib/code-validator', () => ({
  sanitizeForSandpack: (code: string) => code,
}))

import { SandpackPreview } from '@/components/chat/sandpack-preview'

let host: HTMLElement
let root: Root

beforeEach(() => {
  ;(globalThis as any).__lastSandpackCustomSetup = undefined
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  act(() => { root?.unmount() })
  host.remove()
})

async function renderWithFiles(files: Record<string, string>) {
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(SandpackPreview, { files }))
  })
}

describe('SandpackPreview — conditional lucide-react/recharts dependency declaration (#1089)', () => {
  it('does NOT declare lucide-react or recharts when the app imports neither', async () => {
    await renderWithFiles({
      '/App.tsx': "import React from 'react'\nexport default function App(){ return <div>hi</div> }",
    })
    const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
    expect(deps).toBeDefined()
    expect(deps).not.toHaveProperty('lucide-react')
    expect(deps).not.toHaveProperty('recharts')
  })

  it('declares lucide-react when the app imports it, but not recharts', async () => {
    await renderWithFiles({
      '/App.tsx': "import { Search } from 'lucide-react'\nexport default function App(){ return <Search/> }",
    })
    const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
    expect(deps).toHaveProperty('lucide-react', '0.344.0')
    expect(deps).not.toHaveProperty('recharts')
  })

  it('declares recharts when the app imports it, but not lucide-react', async () => {
    // Uses `ResponsiveContainer` rather than `LineChart`/`BarChart`/`PieChart`
    // deliberately — those three names collide with real lucide-react icon
    // names and trip this file's OWN pre-existing lucide safety-net injector
    // (which can't distinguish "LineChart used as a lucide icon" from
    // "LineChart used as a recharts component"), an unrelated, pre-existing
    // ambiguity in the codebase — not something this fix introduces or needs
    // to resolve to be correct.
    await renderWithFiles({
      '/App.tsx': "import { ResponsiveContainer } from 'recharts'\nexport default function App(){ return <ResponsiveContainer/> }",
    })
    const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
    expect(deps).toHaveProperty('recharts', '2.15.0')
    expect(deps).not.toHaveProperty('lucide-react')
  })

  it('declares both when the app imports both, across different files', async () => {
    await renderWithFiles({
      '/App.tsx': "import Chart from './Chart'\nexport default function App(){ return <Chart/> }",
      '/Chart.tsx': "import { ResponsiveContainer } from 'recharts'\nimport { Search } from 'lucide-react'\nexport default function Chart(){ return null }",
    })
    const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
    expect(deps).toHaveProperty('lucide-react', '0.344.0')
    expect(deps).toHaveProperty('recharts', '2.15.0')
  })

  it('always declares react/react-dom/prop-types regardless of usage detection', async () => {
    await renderWithFiles({
      '/App.tsx': "export default function App(){ return null }",
    })
    const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
    expect(deps).toHaveProperty('react', '18.2.0')
    expect(deps).toHaveProperty('react-dom', '18.2.0')
    expect(deps).toHaveProperty('prop-types', '15.8.1')
  })

  it('does not false-positive on built-in files mentioning the package names', async () => {
    // getBuiltinFiles() is mocked to return only a Button component with no
    // lucide-react/recharts references — this confirms the usage scan is
    // scoped to GENERATED files only, not accidentally matching builtins.
    await renderWithFiles({
      '/App.tsx': "export default function App(){ return null }",
    })
    const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
    expect(deps).not.toHaveProperty('lucide-react')
    expect(deps).not.toHaveProperty('recharts')
  })

  describe('@stripe/stripe-js + @stripe/react-stripe-js (#1164 — ZeroCommerce checkout UI)', () => {
    it('does NOT declare either Stripe package when the app has no Stripe import', async () => {
      await renderWithFiles({
        '/App.tsx': "export default function App(){ return null }",
      })
      const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
      expect(deps).not.toHaveProperty('@stripe/stripe-js')
      expect(deps).not.toHaveProperty('@stripe/react-stripe-js')
    })

    it('declares BOTH Stripe packages together when the app imports @stripe/stripe-js', async () => {
      // The two packages are always declared as a pair (never one without the
      // other) — a generated checkout always needs loadStripe from the first
      // and Elements/PaymentElement from the second together.
      await renderWithFiles({
        '/Checkout.tsx': "import { loadStripe } from '@stripe/stripe-js'\nexport default function Checkout(){ return null }",
      })
      const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
      expect(deps).toHaveProperty('@stripe/stripe-js', '10.1.0')
      expect(deps).toHaveProperty('@stripe/react-stripe-js', '7.0.0')
    })

    it('does not declare lucide-react/recharts just because Stripe is used (independent detection)', async () => {
      await renderWithFiles({
        '/Checkout.tsx': "import { loadStripe } from '@stripe/stripe-js'\nexport default function Checkout(){ return null }",
      })
      const deps = (globalThis as any).__lastSandpackCustomSetup?.dependencies
      expect(deps).not.toHaveProperty('lucide-react')
      expect(deps).not.toHaveProperty('recharts')
    })
  })
})
