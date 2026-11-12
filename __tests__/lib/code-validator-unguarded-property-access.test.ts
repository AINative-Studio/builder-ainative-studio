import { describe, it, expect } from 'vitest'
import { sanitizeForSandpack } from '@/lib/code-validator'

/**
 * #1926: autoFixCode's UNGUARDED PROPERTY ACCESS guard (the `a.b.toLowerCase()`
 * -> `(a.b || '').toLowerCase()` rewrite) used to run against the raw,
 * unmasked file text, so a `//`/`/* *\/` comment that merely MENTIONS this
 * exact call shape had its own text silently rewritten too — same bug class
 * as the ~35 already-fixed comment-blind scans in this series (#1872-#1923).
 */
describe('code-validator — UNGUARDED PROPERTY ACCESS guard is comment-blind-safe (#1926)', () => {
  it('still guards a real unsafe string-method access', () => {
    const code = [
      "import React from 'react'",
      'export default function List({ rows }) {',
      '  return (<ul>{rows.map(row => <li key={row.id}>{row.name.toLowerCase()}</li>)}</ul>)',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain("(row.name || '').toLowerCase()")
  })

  it('still guards a real unsafe number-method access', () => {
    const code = [
      "import React from 'react'",
      'export default function Price({ item }) {',
      '  return (<span>{item.price.toFixed(2)}</span>)',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('(item.price || 0).toFixed(2)')
  })

  it('does not rewrite a comment that only mentions the unsafe shape', () => {
    const code = [
      "import React from 'react'",
      '// row.name.toLowerCase() used to crash here before the guard was added',
      'export default function List({ rows }) {',
      '  return (<ul>{rows.map(row => <li key={row.id}>{(row.name || "").toLowerCase()}</li>)}</ul>)',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain(
      '// row.name.toLowerCase() used to crash here before the guard was added',
    )
  })

  it('does not rewrite a block comment that only mentions the unsafe shape', () => {
    const code = [
      "import React from 'react'",
      '/* reminder: item.price.toFixed(2) needs a guard if price can be missing */',
      'export default function App() { return (<div>hi</div>) }',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain(
      '/* reminder: item.price.toFixed(2) needs a guard if price can be missing */',
    )
  })

  it('leaves an already-optional-chained access untouched', () => {
    const code = [
      "import React from 'react'",
      'export default function List({ rows }) {',
      '  return (<ul>{rows.map(row => <li key={row.id}>{row.name?.toLowerCase()}</li>)}</ul>)',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('row.name?.toLowerCase()')
    expect(fixed).not.toContain("(row.name || '')")
  })
})
