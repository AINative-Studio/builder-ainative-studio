import { describe, it, expect } from 'vitest'
import { sanitizeForSandpack } from '@/lib/code-validator'

/**
 * Regression: autoFixCode's "Fix 10" single-h1 AX rule (AX-5) scanned raw,
 * unmasked code for `<h1` / `</h1>` occurrences. A commented-out example
 * mentioning `<h1` counted as a real heading, which could either wrongly
 * demote the page's only real <h1> to <h2> (no AX-5 heading left at all),
 * or — when the comment's snippet had an opening tag with no matching
 * closing tag in the comment — desync the independently-counted open/close
 * passes and emit mismatched `<h2>...</h1>` JSX, a guaranteed parse error.
 */
describe('autoFixCode AX-5 single-h1 rule is comment-blind', () => {
  it('does not touch the only real <h1> because of a commented-out <h1> mention', () => {
    const code = [
      "import React from 'react'",
      '// Example usage: <h1 className="hero">',
      'export default function App() {',
      '  return (',
      '    <div>',
      '      <h1>Real Title</h1>',
      '      <p>hello</p>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)

    expect(fixed).toContain('<h1>Real Title</h1>')
    expect(fixed).not.toMatch(/<h2>Real Title<\/h1>/)
    expect(fixed).not.toMatch(/<h1>Real Title<\/h2>/)
  })

  it('still converts a genuine second real h1 to h2', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  return (',
      '    <div>',
      '      <h1>First</h1>',
      '      <h1>Second</h1>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)

    expect(fixed).toContain('<h1>First</h1>')
    expect(fixed).toContain('<h2>Second</h2>')
  })
})
