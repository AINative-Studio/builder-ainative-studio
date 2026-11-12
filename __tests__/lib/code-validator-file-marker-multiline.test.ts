import { describe, it, expect } from 'vitest'
import {
  findObjectRenderedAsChild,
  findUnresolvedComponents,
  findUndefinedReferences,
} from '@/lib/code-validator'

/**
 * Regression: FILE_MARKER (`^\/\/\s*---\s*FILE:\s*(.+?)\s*---\s*$`) has no `m`
 * flag, so `^`/`$` anchor to the whole input, not each line. `.split(FILE_MARKER)`
 * on real multi-file content (more than one line) can then only match if the
 * ENTIRE blob is literally one marker line — so it silently never splits, and a
 * caller relying on it for real per-file scoping scans the whole blob pooled as
 * one file instead. findObjectRenderedAsChild and findUndefinedReferences both
 * document (and need) real per-file scoping, so they now split on the new,
 * correctly-anchored FILE_MARKER_SPLIT instead. findUnresolvedComponents keeps
 * using the original FILE_MARKER/pooled behavior on purpose (see its own test
 * below) — only the two callers with a genuine scoping bug were touched.
 */
describe('FILE_MARKER_SPLIT actually splits multi-file content per file', () => {
  it('findObjectRenderedAsChild: an unrelated object literal in one file must not ' +
    'false-flag a same-named prop rendered as a JSX child in a sibling file', () => {
    const code = [
      '// --- FILE: src/App.tsx ---',
      'import Foo from "./components/Foo"',
      'const data = { x: 1 }',
      'export default function App() { return <div><Foo data="hi" /></div> }',
      '// --- FILE: src/components/Foo.tsx ---',
      'export default function Foo({ data }: { data: string }) { return <div>{data}</div> }',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('findObjectRenderedAsChild: a real object-as-child bug within one file of a ' +
    'multi-file blob is still caught', () => {
    const code = [
      '// --- FILE: src/App.tsx ---',
      'const data = { x: 1 }',
      'export default function App() { return <div>{data}</div> }',
      '// --- FILE: src/components/Foo.tsx ---',
      'export default function Foo() { return <div>ok</div> }',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBe('data')
  })

  it('findUndefinedReferences: a name declared in one file must not suppress a ' +
    'real undefined reference to the same name in a sibling file', () => {
    const resolved = [
      '// --- FILE: src/App.tsx ---',
      'const count = 1',
      'export default function App() { return <div>{count}</div> }',
      '// --- FILE: src/components/Foo.tsx ---',
      'const count = 2',
      'export default function Foo() { return <div>{count}</div> }',
    ].join('\n')
    expect(findUndefinedReferences(resolved)).toBeNull()

    const undeclaredInSibling = [
      '// --- FILE: src/App.tsx ---',
      'const totalOrders = 1',
      'export default function App() { return <div>{totalOrders}</div> }',
      '// --- FILE: src/components/Foo.tsx ---',
      // totalOrders is only declared in App.tsx above — a separate module, so
      // this reference must be flagged, not silently resolved via pooling.
      'export default function Foo() { return <div>{totalOrders}</div> }',
    ].join('\n')
    expect(findUndefinedReferences(undeclaredInSibling)).toBe('totalOrders')
  })

  it('findUnresolvedComponents: keeps its intentional pooled behavior unchanged ' +
    '(a component declared anywhere in the blob resolves usage anywhere else — ' +
    'see undefined-components.test.ts, the real import-wiring is a separate ' +
    'mechanism in lib/sandpack/build-files.ts)', () => {
    const code = [
      '// --- FILE: App.tsx ---',
      "import React from 'react'",
      'export default function App(){ return <Sidebar/>; }',
      '// --- FILE: Sidebar.tsx ---',
      'export function Sidebar(){ return <nav/>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('single-file content (no FILE_MARKER at all) is unaffected', () => {
    const bad = 'const data = { x: 1 }\nexport default function App() { return <div>{data}</div> }'
    expect(findObjectRenderedAsChild(bad)).toBe('data')

    const ok = 'export default function App() { return <div>hi</div> }'
    expect(findObjectRenderedAsChild(ok)).toBeNull()
    expect(findUnresolvedComponents(ok)).toEqual([])
    expect(findUndefinedReferences(ok)).toBeNull()
  })
})
