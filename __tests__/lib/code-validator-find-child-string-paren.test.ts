import { describe, it, expect } from 'vitest'
import { findObjectRenderedAsChild } from '@/lib/code-validator'

/**
 * Regression: findObjectRenderedAsChild's SHAPE 2 check (builder#195, nested
 * braces fixed by builder#1267-adjacent work) depth-counts parens to find a
 * `.find(...)`/`.findLast(...)` call's true closing paren, but had no notion
 * of string/template-literal content. A string argument inside the callback
 * containing a lone, unmatched `)` -- e.g. an emoticon or parenthetical aside
 * like `i.label === 'Checkout :)'` -- gets mistaken for the call's real
 * closing paren, so the depth count lines up at the wrong place and the
 * actual "object rendered as JSX child" crash this rule exists to catch is
 * silently missed. Same gap already fixed in component-detector.ts,
 * obedience-gate.ts, output-validator.ts, built-in-rules.ts, and
 * dedupe-provided-components.ts's analogous matchers.
 */
describe('findObjectRenderedAsChild — stray paren inside a string/template literal in .find()/.findLast()', () => {
  it('flags a .find() callback whose body contains a string with an unmatched paren', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, label: "a" }]',
      '  return <div>{items.find(i => { return i.label === \'Checkout :)\' })}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.find(')
  })

  it('flags a .findLast() callback whose template-literal body contains an unmatched paren', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, label: "a" }]',
      '  return <div>{items.findLast(i => { return i.label === `Checkout :)` })}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.findLast(')
  })

  it('does not flag a .find() with a string-paren callback chained with a safe field access', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, label: "a" }]',
      '  return <div>{items.find(i => { return i.label === \'Checkout :)\' })?.label}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('still flags the simple no-string case — no regression', () => {
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
