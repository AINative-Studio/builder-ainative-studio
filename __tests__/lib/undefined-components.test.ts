import { describe, it, expect } from 'vitest'
import {
  findUnresolvedComponents,
  validateJavaScriptCode,
} from '@/lib/code-validator'

/**
 * builder#76 — a component used in JSX but never defined/imported and not a
 * known-available primitive renders as "Element type is invalid: … undefined"
 * in Sandpack. The Babel parse can't catch it; findUnresolvedComponents does.
 */
describe('findUnresolvedComponents (#76)', () => {
  it('flags a hallucinated component (<Header/>) with no source', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ return <div><Header/><Todo/></div>; }',
    ].join('\n')
    const out = findUnresolvedComponents(code)
    expect(out).toContain('Header')
    expect(out).toContain('Todo')
  })

  it('does NOT flag a locally-defined component', () => {
    const code = [
      "import React from 'react'",
      'function Header(){ return <h1>Hi</h1>; }',
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('does NOT flag an imported component', () => {
    const code = [
      "import React from 'react'",
      "import { CustomThing } from './custom'",
      'export default function App(){ return <CustomThing/>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('does NOT flag known AIKit / shadcn primitives (available without import)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){',
      '  return <Card><CardHeader><CardTitle>x</CardTitle></CardHeader><MetricCard/><Button/><AIKitSidebar/></Card>;',
      '}',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('does NOT flag React built-ins (Fragment, Suspense)', () => {
    const code = 'export default function App(){ return <Suspense><Fragment/></Suspense>; }'
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('ignores lowercase HTML tags entirely', () => {
    const code = 'export default function App(){ return <div><section><span/></section></div>; }'
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('resolves a component defined in another file of multi-file output', () => {
    const code = [
      '// --- FILE: App.tsx ---',
      "import React from 'react'",
      'export default function App(){ return <Sidebar/>; }',
      '// --- FILE: Sidebar.tsx ---',
      'export function Sidebar(){ return <nav/>; }',
    ].join('\n')
    // Sidebar is defined in the second file — must not be flagged.
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('handles destructured components (const { X } = ...)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ const { Row } = someLib; return <Row/>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('validateJavaScriptCode rejects code with a hallucinated component', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/Element type is invalid.*Header/i)
  })

  it('validateJavaScriptCode passes clean code using known primitives', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ return <Card><Button>Go</Button></Card>; }',
    ].join('\n')
    expect(validateJavaScriptCode(code).valid).toBe(true)
  })
})
