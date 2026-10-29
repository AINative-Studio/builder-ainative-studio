import { describe, it, expect } from 'vitest'
import { findObjectRenderedAsChild } from '@/lib/code-validator'

/**
 * Regression: findObjectRenderedAsChild's SHAPE 2 check (builder#195) used a
 * flat `\([^{}]*\)` to capture a `.find(...)`/`.findLast(...)` call rendered
 * directly as a JSX child. That can't cross any `{`/`}`, so a callback with a
 * real body, or an object-literal arrow shorthand, never lines up with its
 * true closing `)` — the whole occurrence silently failed to match, missing
 * the exact "Objects are not valid as a React child" crash this rule exists
 * to catch.
 */
describe('findObjectRenderedAsChild — nested brace inside .find()/.findLast() callback', () => {
  it('still flags the simple case (no nested brace) — no regression', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => i.id === 1)}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.find(')
  })

  it('flags a .find() callback with a block body (nested braces)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => { return i.id === 1 })}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.find(')
  })

  it('flags a .findLast() callback returning an object-literal shorthand (nested braces)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.findLast(i => ({ id: i.id }))}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toContain('.findLast(')
  })

  it('does not flag a .find() chained with a safe field access', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [{ id: 1, name: "a" }]',
      '  return <div>{items.find(i => { return i.id === 1 })?.name}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })
})
