import { describe, it, expect } from 'vitest'
import { findObjectRenderedAsChild } from '@/lib/code-validator'

/**
 * Regression: findObjectRenderedAsChild's SHAPE 2 check (builder#195) used to
 * run its `.find(...)`/`.findLast(...)` scan directly against the raw,
 * unmasked code, so a `>{ x.find(...) }<` shape mentioned only inside a
 * comment or a string/template literal (a demo code snippet, a "how this
 * works" aside) was indistinguishable from a REAL JSX child — a
 * false-positive "Objects are not valid as a React child" validation
 * failure on genuinely valid generated code.
 */
describe('findObjectRenderedAsChild — comment/string-blind SHAPE 2 false positive', () => {
  it('does not flag a .find() chain mentioned only inside a // comment', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  // example usage: <div>{items.find(i => i.id === x)}</div>',
      '  return <div>Hello</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not flag a .find() chain mentioned only inside a /* */ block comment', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  /* usage: <div>{items.find(i => i.id === x)}</div> */',
      '  return <div>Hello</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not flag a .find() chain appearing only inside a template-literal demo snippet', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const demoCode = `<div>{items.find(i => i.id === x)}</div>`',
      '  return <pre>{demoCode}</pre>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not flag a .findLast() chain appearing only inside a quoted string', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      "  const demoCode = '<div>{items.findLast(i => i.id === x)}</div>'",
      '  return <pre>{demoCode}</pre>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('still flags a REAL (uncommented, non-string) .find() rendered as a JSX child', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => i.id === 1)}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.find(')
  })

  it('still flags a REAL .find() even when an unrelated decoy sits in a comment nearby', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  // decoy: <div>{other.find(i => i.id === x)}</div>',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => i.id === 1)}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('items.find(')
  })
})
