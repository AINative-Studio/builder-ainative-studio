import { describe, it, expect } from 'vitest'
import { sanitizeForSandpack } from '@/lib/code-validator'

/**
 * #1923: autoFixCode's MOBILE TABLE OVERFLOW pass (builder#196) used to
 * regex-scan the raw, unmasked code for `<table ...>...</table>` and wrap
 * every match in `<div className="overflow-x-auto">`, including a `<table>`
 * that only appears inside a comment. In the worst case a comment's own
 * `<table>` mention has no matching `</table>` before a real, unrelated
 * table later in the file, so the non-greedy match spans from inside the
 * comment, across its closing delimiter and any real code in between, to
 * that real `</table>` — corrupting real JSX, not just the comment.
 */
describe('code-validator — autoFixCode MOBILE TABLE OVERFLOW masks comments first (#1923)', () => {
  it('does not wrap a <table> mention that only appears inside a comment', () => {
    const code = [
      "import React from 'react'",
      '// layout note: keep the <table><tr><td>data</td></tr></table> compact on mobile',
      'export default function App() {',
      "  return (<div>hi</div>)",
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).not.toContain('overflow-x-auto')
    expect(fixed).toContain(
      '// layout note: keep the <table><tr><td>data</td></tr></table> compact on mobile',
    )
  })

  it('does not corrupt real JSX by spanning a comment-only <table> mention into a real table later in the file', () => {
    const code = [
      "import React from 'react'",
      '/* reminder: our old <table> markup used to overflow */',
      'export default function App() {',
      '  return (',
      '    <div>',
      '      <table><tr><td>Real Row</td></tr></table>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    // The unmasked version would have matched from the comment's "<table>"
    // mention (no "</table>" inside that comment) all the way to the next
    // real "</table>", then wrapped that whole span in a single
    // <div className="overflow-x-auto">...</div> — swallowing the comment's
    // closing "*/" and the function declaration in between into one element,
    // breaking the JSX. The fix must not do that: skip this unsafe match
    // entirely rather than produce corrupted output. Nothing here should be
    // wrapped (the only <table> open tag the regex can see starts inside the
    // masked comment), and the comment + real code must survive intact.
    expect(fixed).not.toContain('overflow-x-auto')
    expect(fixed).toContain('/* reminder: our old <table> markup used to overflow */')
    expect(fixed).toContain('export default function App()')
    expect(fixed).toContain('<table><tr><td>Real Row</td></tr></table>')
  })

  it('still wraps a real, bare <table> with no preceding comment mention', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  return (<table className="w-full"><tr><td>A</td></tr></table>)',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain(
      '<div className="overflow-x-auto"><table className="w-full"><tr><td>A</td></tr></table></div>',
    )
  })
})
