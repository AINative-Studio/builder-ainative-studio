import { describe, it, expect } from 'vitest'
import { isScaffoldApp, SCAFFOLD_APP_MARKER } from '@/lib/agent/worktree-manager'

/**
 * #348 — the seed scaffold must never pass as the app. When the agent dies
 * without editing src/App.tsx (#350), the untouched stub gets persisted and
 * passes every parse/render/completeness gate because it IS valid React. The
 * scaffold-identity gate rejects it. These lock the detector.
 */

const REAL_APP = `import { useState } from 'react'
export default function App() {
  const [items, setItems] = useState([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }])
  const [q, setQ] = useState('')
  return (
    <div className="p-8">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      <ul>{items.filter(i => i.name.includes(q)).map(i => <li key={i.id}>{i.name}</li>)}</ul>
    </div>
  )
}`

describe('isScaffoldApp (#348)', () => {
  it('flags code carrying the sentinel marker', () => {
    expect(isScaffoldApp(`// ${SCAFFOLD_APP_MARKER}\nexport default function App(){return null}`)).toBe(true)
  })

  it('flags null / empty / whitespace', () => {
    expect(isScaffoldApp(null)).toBe(true)
    expect(isScaffoldApp(undefined)).toBe(true)
    expect(isScaffoldApp('')).toBe(true)
    expect(isScaffoldApp('   \n  ')).toBe(true)
  })

  it('flags the legacy "Builder Session" 263-char stub (back-compat, no marker)', () => {
    const legacy = `import { useState } from 'react'
export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <h1 className="text-2xl font-bold text-gray-900">Builder Session</h1>
    </div>
  )
}`
    expect(isScaffoldApp(legacy)).toBe(true)
  })

  it('flags the new "Preparing your app…" placeholder stub', () => {
    const stub = `export default function App(){return <h1>Preparing your app…</h1>}`
    expect(isScaffoldApp(stub)).toBe(true)
  })

  it('does NOT flag a real app (substantial, no placeholder text)', () => {
    expect(isScaffoldApp(REAL_APP)).toBe(false)
  })

  it('does NOT flag a real app that happens to be long even if it mentions a heading', () => {
    // A genuine app > 400 chars is never treated as scaffold even with the marker absent.
    const bigApp = REAL_APP + '\n' + '// padding '.repeat(60)
    expect(isScaffoldApp(bigApp)).toBe(false)
  })
})
