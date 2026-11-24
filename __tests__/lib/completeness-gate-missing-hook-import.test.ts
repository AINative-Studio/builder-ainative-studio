import { describe, it, expect } from 'vitest'
import { findMissingReactHookImports } from '@/lib/build/completeness-gate'

/**
 * Issue #2230 — a file calls a built-in React hook (useState/useEffect/...)
 * with zero import of it in that file. Each generated file bundles as its
 * own ES module, so this throws a real `ReferenceError: X is not defined` at
 * render time. Neither findMissingLocalImports (LOCAL specifiers only) nor
 * findUndeclaredJsxComponents (JSX TAG usage only) can see a bare hook call.
 *
 * Repro (live showcase "cartly", 2026-11-24): FeaturedProducts.tsx calls
 * `const [selected, setSelected] = useState(null)` with no import of React
 * or useState anywhere in the file.
 */

describe('findMissingReactHookImports', () => {
  it('returns [] when the hook is imported alongside the default React import', () => {
    const files = {
      '/src/App.tsx': `import React, { useState } from 'react'\nexport default function App(){ const [x] = useState(0); return <div/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('returns [] when the hook is imported named-only', () => {
    const files = {
      '/src/App.tsx': `import { useState, useEffect } from 'react'\nexport default function App(){ const [x] = useState(0); useEffect(() => {}, []); return <div/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('returns [] for a multi-line import clause', () => {
    const files = {
      '/src/App.tsx': [
        `import React, {`,
        `  useState,`,
        `  useEffect,`,
        `} from 'react'`,
        `export default function App(){ const [x] = useState(0); useEffect(() => {}, []); return <div/> }`,
      ].join('\n'),
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('CARTLY REPRO: flags useState called with zero react import in the file', () => {
    const files = {
      '/src/components/FeaturedProducts.tsx': [
        `import { Button } from './ui/button'`,
        `export default function FeaturedProducts() {`,
        `  const [selected, setSelected] = useState(null);`,
        `  return <div/>`,
        `}`,
      ].join('\n'),
    }
    expect(
      findMissingReactHookImports(files['/src/components/FeaturedProducts.tsx'], files),
    ).toEqual(['useState'])
  })

  it('does not flag React.useState(...) — a namespace member access needs no import', () => {
    const files = {
      '/src/App.tsx': `import * as React from 'react'\nexport default function App(){ const [x] = React.useState(0); return <div/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('does not flag an arbitrary custom hook (useCart) that is not a React built-in', () => {
    const files = {
      '/src/App.tsx': `import { useCart } from './hooks/useCart'\nexport default function App(){ const cart = useCart(); return <div/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('does not flag a hook the file locally redefines itself', () => {
    const files = {
      '/src/App.tsx': `function useState(initial) { return [initial, () => {}] }\nexport default function App(){ const [x] = useState(0); return <div/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('handles a generic type argument between the hook name and its call parens', () => {
    const files = {
      '/src/App.tsx': `export default function App(){ const ref = useRef<HTMLInputElement>(null); return <input ref={ref}/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual(['useRef'])
  })

  it('does not flag a hook merely mentioned in a comment', () => {
    const files = {
      '/src/App.tsx': `// TODO: add useState(0) here later\nexport default function App(){ return <div/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('checks every source file, not just the entry', () => {
    const files = {
      '/src/App.tsx': `import React from 'react'\nimport Widget from './components/Widget'\nexport default function App(){ return <Widget/> }`,
      '/src/components/Widget.tsx': `export default function Widget(){ const [x] = useState(0); return <div/> }`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual(['useState'])
  })

  it('does not scan non-code files', () => {
    const files = {
      '/src/App.tsx': `export default function App(){ return <div/> }`,
      '/public/llms.txt': `useState(0) mentioned here`,
    }
    expect(findMissingReactHookImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('returns [] without a files map (single-blob payloads get no per-file scope coverage)', () => {
    const code = `export default function App(){ const [x] = useState(0); return <div/> }`
    expect(findMissingReactHookImports(code)).toEqual([])
  })

  it('resolves a concatenated // --- FILE: --- blob into per-file boundaries', () => {
    const code = [
      `// --- FILE: src/components/FeaturedProducts.tsx ---`,
      `export default function FeaturedProducts() { const [x] = useState(null); return <div/> }`,
    ].join('\n')
    expect(findMissingReactHookImports(code)).toEqual(['useState'])
  })

  it('never throws on garbage input (fail-open)', () => {
    expect(findMissingReactHookImports('')).toEqual([])
    expect(findMissingReactHookImports('<<<not real code')).toEqual([])
    expect(findMissingReactHookImports(null as unknown as string)).toEqual([])
  })
})
