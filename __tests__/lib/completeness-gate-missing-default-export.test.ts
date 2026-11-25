import { describe, it, expect } from 'vitest'
import { findMissingDefaultExports } from '@/lib/build/completeness-gate'

/**
 * Default-export mismatch detector (governing-priority rendering-correctness
 * gap): findMissingLocalImports() proves a default import's target FILE
 * exists somewhere in the payload, but never checks whether that file
 * actually exports a default — a component authored as `export function
 * Foo()` with no `export default` still satisfies it. At runtime the default
 * binding resolves to `undefined` and React throws "Element type is
 * invalid" the moment `<Foo/>` renders. findMissingDefaultExports() closes
 * that gap.
 */

describe('findMissingDefaultExports', () => {
  it('returns [] for undefined/empty files map', () => {
    expect(findMissingDefaultExports(undefined)).toEqual([])
    expect(findMissingDefaultExports({})).toEqual([])
  })

  it('returns [] when every default import resolves to a real default export', () => {
    const files = {
      '/src/App.tsx': `import Header from './components/Header'\nexport default function App(){ return <div><Header/></div> }`,
      '/src/components/Header.tsx': `export default function Header(){ return <header/> }`,
    }
    expect(findMissingDefaultExports(files)).toEqual([])
  })

  it('flags a default import whose target file exists but never exports a default', () => {
    const files = {
      '/src/App.tsx': `import TrainingPanel from './components/TrainingPanel'\nexport default function App(){ return <TrainingPanel/> }`,
      // Real file, really defined — just never re-exported as the default.
      '/src/components/TrainingPanel.tsx': `export function TrainingPanel(){ return <div/> }`,
    }
    expect(findMissingDefaultExports(files)).toEqual(['./components/TrainingPanel'])
  })

  it('does not flag a pure named import (no default specifier) even if the target has no default export', () => {
    const files = {
      '/src/App.tsx': `import { TrainingPanel } from './components/TrainingPanel'\nexport default function App(){ return <TrainingPanel/> }`,
      '/src/components/TrainingPanel.tsx': `export function TrainingPanel(){ return <div/> }`,
    }
    expect(findMissingDefaultExports(files)).toEqual([])
  })

  it('does not flag an unresolved import — that is findMissingLocalImports() job, not this one', () => {
    const files = {
      '/src/App.tsx': `import Ghost from './components/Ghost'\nexport default function App(){ return <Ghost/> }`,
    }
    expect(findMissingDefaultExports(files)).toEqual([])
  })

  it('accepts a default export declared separately from its definition', () => {
    const files = {
      '/src/App.tsx': `import Header from './components/Header'\nexport default function App(){ return <Header/> }`,
      '/src/components/Header.tsx': `function Header(){ return <header/> }\nexport default Header`,
    }
    expect(findMissingDefaultExports(files)).toEqual([])
  })

  it('accepts a barrel-style `export { Name as default }` re-export', () => {
    const files = {
      '/src/App.tsx': `import Header from './components/Header'\nexport default function App(){ return <Header/> }`,
      '/src/components/Header.tsx': `function Header(){ return <header/> }\nexport { Header as default }`,
    }
    expect(findMissingDefaultExports(files)).toEqual([])
  })

  it('handles a mixed default + named import (`import Foo, { Bar } from ...`)', () => {
    const files = {
      '/src/App.tsx': `import Panel, { helper } from './components/Panel'\nexport default function App(){ return <Panel/> }`,
      '/src/components/Panel.tsx': `export function helper(){ return 1 }\nexport function Panel(){ return <div/> }`,
    }
    expect(findMissingDefaultExports(files)).toEqual(['./components/Panel'])
  })

  it('ignores runtime-provided (aikit/shadcn) and asset imports', () => {
    const files = {
      '/src/App.tsx': `import Button from './components/ui/button'\nimport logo from './logo.svg'\nexport default function App(){ return <Button/> }`,
    }
    expect(findMissingDefaultExports(files)).toEqual([])
  })

  it('never throws on malformed input', () => {
    expect(() => findMissingDefaultExports({ '/src/App.tsx': null as unknown as string })).not.toThrow()
  })
})
