import { describe, it, expect } from 'vitest'
import { findUnresolvedComponents } from '@/lib/code-validator'

/**
 * findUnresolvedComponents' destructuring scan (findMatchingBraceInDestructureCheck)
 * already skips string/template-literal content (#1690's fix, see
 * code-validator-destructure-string-brace.test.ts) but has no notion of `//`
 * or `/* *\/` comments. A destructured default value followed by a comment
 * containing a lone, unmatched `}` — e.g.
 * `const { label = 'Status', /* was: } * \/ Icon } = props` — gets mistaken
 * for the pattern's real close, truncating the slice handed to the
 * PascalCase-identifier scan before any binding that comes after the
 * comment. That binding (here `Icon`) never becomes "available", and using
 * it in JSX gets falsely flagged as an unresolved component — same bug
 * class as #1715/#1729/#1733/#1744/#1745's comment-blind depth-counters,
 * applied here to this function's destructuring-pattern matcher.
 */
describe('findUnresolvedComponents — stray brace inside a destructuring comment', () => {
  it('does not flag a component bound after a line comment containing a stray }', () => {
    const code = [
      "import React from 'react'",
      'function Header(props) {',
      '  const {',
      "    label = 'Status',",
      '    // legacy shape was }',
      '    Icon,',
      '  } = props',
      '  return <div><Icon/>{label}</div>',
      '}',
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).not.toContain('Icon')
  })

  it('does not flag a component bound after a block comment containing a stray }', () => {
    const code = [
      "import React from 'react'",
      'function Header(props) {',
      "  const { label = 'Status', /* was: } wider */ Icon } = props",
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
