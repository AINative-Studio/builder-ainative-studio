import { describe, it, expect } from 'vitest'
import { findObjectRenderedAsChild } from '@/lib/code-validator'

/**
 * Regression: findObjectRenderedAsChild's SHAPE 1 check (builder#184) — a
 * `const x = {...}` declaration plus a bare `>{x}<` JSX-child mention — ran
 * all three of its regex scans directly against the raw, unmasked code, so
 * either half of the shape could be satisfied by text inside a comment or a
 * string/template literal (a demo code snippet, a "how this works" aside)
 * instead of real code. #1902/PR #1903 fixed this exact gap for SHAPE 2
 * (the sibling `.find()`/`.findLast()` check in the same function) but left
 * SHAPE 1 with the identical blindness (#1908).
 */
describe('findObjectRenderedAsChild — comment/string-blind SHAPE 1 false positive', () => {
  it('does not flag a real object declaration whose >{x}< mention is only inside a template-literal demo snippet', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const config = { a: 1 }',
      '  const demo = `<div>{config}</div>`',
      '  return <pre>{demo}</pre>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not flag a real object declaration whose >{x}< mention is only inside a quoted-string demo snippet', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const config = { a: 1 }',
      "  const demo = '<div>{config}</div>'",
      '  return <pre>{demo}</pre>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not flag a real object declaration whose >{x}< mention is only inside a // comment', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const settings = { theme: "dark" }',
      '  // example usage: <div>{settings}</div>',
      '  return <div>Hello</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not flag a // comment-only object declaration (the declaration half of the shape never happened)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  // const draft = { a: 1 }',
      '  return <div>Hello</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not let a commented-out array reassignment wrongly exclude a REAL object-literal bug', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const settings = { theme: "dark" }',
      '  // settings = []  (old approach, no longer used)',
      '  return <div>{settings}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBe('settings')
  })

  it('still flags a REAL (uncommented, non-string) object literal rendered as a JSX child', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const settings = { theme: "dark" }',
      '  return <div>{settings}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBe('settings')
  })

  it('still flags a REAL object-literal bug even when an unrelated decoy sits in a comment nearby', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  // decoy: <div>{other}</div>',
      '  const settings = { theme: "dark" }',
      '  return <div>{settings}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBe('settings')
  })

  it('still does not flag a genuinely array-bound identifier (real reassignment, not a decoy)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  let items = { a: 1 }',
      '  items = []',
      '  return <div>{items}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })
})
