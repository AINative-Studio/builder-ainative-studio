import { describe, it, expect } from 'vitest'
import { findUnresolvedComponents } from '@/lib/code-validator'

/**
 * findUnresolvedComponents' destructuring scan (added for #1639, which fixed
 * nested-brace handling) depth-counts `{`/`}` to find a `const {...} = ...`
 * pattern's real closing brace, but has no notion of string/template-literal
 * content. A destructured default value containing a lone, unmatched `}` —
 * e.g. `const { label = 'Status }', Icon } = props` — gets mistaken for the
 * pattern's real close, so the slice handed to the PascalCase-identifier
 * scan is truncated before any binding that comes after the stray `}`. Any
 * such binding (here `Icon`) never becomes "available", and using it in JSX
 * gets falsely flagged as an unresolved component — the same bug class as
 * #1654/#1675/#1686/#1688/#1690's string-blind depth-counters, applied here
 * to this function's destructuring-pattern matcher.
 */
describe('findUnresolvedComponents — stray brace inside a destructured default string/template literal', () => {
  it('does not flag a component bound after a string-literal default containing a stray }', () => {
    const code = [
      "import React from 'react'",
      'function Header(props) {',
      "  const { label = 'Status }', Icon } = props",
      '  return <div><Icon/>{label}</div>',
      '}',
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).not.toContain('Icon')
  })

  it('does not flag a component bound after a template-literal default containing a stray }', () => {
    const code = [
      "import React from 'react'",
      'function Header(props) {',
      '  const { label = `Status }`, Icon } = props',
      '  return <div><Icon/>{label}</div>',
      '}',
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).not.toContain('Icon')
  })

  it('still flags a genuinely unresolved component with no destructuring involved (no regression)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toContain('Header')
  })
})
