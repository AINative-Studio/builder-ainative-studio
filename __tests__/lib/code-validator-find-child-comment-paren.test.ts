import { describe, it, expect } from 'vitest'
import { findObjectRenderedAsChild } from '@/lib/code-validator'

/**
 * Regression: findObjectRenderedAsChild's SHAPE 2 check (builder#195)
 * depth-counts parens to find a `.find(...)`/`.findLast(...)` call's true
 * closing paren. #1688/#1689 taught the counter to skip string/template
 * literal content, but it still had no notion of `//`/`/* *\/` comments -- a
 * commented-out aside containing a lone, unmatched `(` inside the callback
 * body throws off the depth count, so the call's real closing paren is
 * never found and the "Objects are not valid as a React child" crash this
 * rule exists to catch is silently missed.
 */
describe('findObjectRenderedAsChild — stray paren inside a comment in .find()/.findLast()', () => {
  it('flags a .find() callback with a // line comment containing an unmatched paren', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => { // note: legacy (unused',
      '    return i.id === 1',
      '  })}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.find(')
  })

  it('flags a .findLast() callback with a /* */ block comment containing an unmatched paren', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.findLast(i => { /* legacy (unused */ return i.id === 1 })}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.findLast(')
  })

  it('does not flag a .find() with a commented-paren callback chained with a safe field access', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => { // note: legacy (unused',
      '    return i.id === 1',
      '  })?.name}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('still flags the simple no-comment case — no regression', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => i.id === 1)}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.find(')
  })
})
