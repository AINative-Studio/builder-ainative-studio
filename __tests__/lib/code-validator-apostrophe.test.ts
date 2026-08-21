import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { sanitizeForSandpack, validateGeneratedCode } from '@/lib/code-validator'

/**
 * Regression (builder#271): a contraction ("it's", "you're") inside a
 * single-quoted content string ends the string early and throws
 *   SyntaxError: Unexpected token, expected ","
 * Exact live failure (Ember coffee company, /build/ember):
 *   description: 'Whether you need it in 5 minutes or an hour, we brew it
 *                 fresh so it's perfect when you arrive.'
 * The auto-fix pass must repair such literals (convert to double quotes, or
 * escape the interior apostrophe) WITHOUT corrupting otherwise-valid code.
 */

const parseOk = (code: string) =>
  parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })

describe('apostrophe-in-single-quote corruption (builder#271)', () => {
  it("repairs the exact 'it\\'s perfect when you arrive' case into parseable code", () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const feature = {',
      "    description: 'Whether you need it in 5 minutes or an hour, we brew it fresh so it's perfect when you arrive.',",
      '  }',
      '  return <div>{feature.description}</div>',
      '}',
    ].join('\n')

    // Sanity: the raw code is genuinely broken.
    expect(() => parseOk(code)).toThrow()

    const fixed = sanitizeForSandpack(code)
    // The repaired code must parse cleanly.
    expect(() => parseOk(fixed)).not.toThrow()
    // The content is preserved.
    expect(fixed).toContain("it's perfect when you arrive")
  })

  it('end-to-end: validateGeneratedCode accepts the Ember description block', () => {
    const md = [
      '```jsx',
      "import React from 'react'",
      'export default function App() {',
      '  const features = [',
      "    { title: 'Fast', description: 'we brew it fresh so it's perfect when you arrive' },",
      "    { title: 'Local', description: 'you're always close to a great cup' },",
      '  ]',
      '  return <ul>{features.map((f, i) => <li key={i}>{f.description}</li>)}</ul>',
      '}',
      '```',
    ].join('\n')

    const r = validateGeneratedCode(md)
    expect(r.valid).toBe(true)
    expect(() => parseOk(r.code)).not.toThrow()
  })

  it("escapes the interior apostrophe when the literal already contains a double quote", () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      "  const msg = 'the \"house\" blend it's our favorite'",
      '  return <div>{msg}</div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    // Delimiter stays single-quoted (would clash with interior "), apostrophe escaped.
    expect(fixed).toContain("it\\'s our favorite")
  })

  // NOTE: `sanitizeForSandpack` runs the FULL auto-fix pipeline, which may
  // legitimately append trailing semicolons (pre-existing "Fix 9"). The
  // no-false-positive guarantee for THIS fix is: the apostrophe transform
  // introduces no delimiter swap and no `\'` escaping, and the output still
  // parses. We assert that below rather than byte-exact equality.
  it('does NOT touch valid single-quoted strings (no false positives)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      "  const a = 'hello world'",
      "  const b = 'paid'",
      "  const list = ['a', 'b', 'c']",
      '  return <div>{a}{b}{list.length}</div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    // Untouched literals: no escaping introduced, delimiters unchanged.
    expect(fixed).toContain("const a = 'hello world'")
    expect(fixed).toContain("const b = 'paid'")
    expect(fixed).toContain("['a', 'b', 'c']")
    expect(fixed).not.toContain('\\\'')
  })

  it('does NOT touch apostrophes inside double-quoted strings or already-escaped', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const a = "don\'t change me"',
      "  const b = 'already \\'escaped\\' fine'",
      '  return <div>{a}{b}</div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    // Double-quoted apostrophe left as-is; already-escaped literal left as-is.
    expect(fixed).toContain('"don\'t change me"')
    expect(fixed).toContain("'already \\'escaped\\' fine'")
  })

  it('does NOT touch apostrophes inside template literals, comments, or regex', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const t = `it\'s fine in a template`',
      "  // it's fine in a comment",
      "  const re = /it's fine in a regex/",
      "  const s = 'plain'",
      '  return <div>{t}{s}{String(re)}</div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    // Template / comment / regex apostrophes untouched (no delimiter swap, no escaping).
    expect(fixed).toContain('`it\'s fine in a template`')
    expect(fixed).toContain("// it's fine in a comment")
    expect(fixed).toContain("/it's fine in a regex/")
  })

  it('does NOT corrupt valid single-quoted JSX attribute values (multi-attr)', () => {
    // Scope guard: two single-quoted attributes on one tag. There is no interior
    // apostrophe here, so the fix must be a no-op and the tag must stay valid.
    const code = [
      "import React from 'react'",
      'export default function App() {',
      "  return <img alt='hero image' src='/x.png' />",
      '}',
    ].join('\n')

    expect(() => parseOk(code)).not.toThrow()
    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    expect(fixed).toContain("alt='hero image'")
    expect(fixed).toContain("src='/x.png'")
  })

  it('leaves JSX text apostrophes untouched (they are not string literals)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      "  return <p>We don't compromise on quality</p>",
      '}',
    ].join('\n')

    // JSX text is valid as-is.
    expect(() => parseOk(code)).not.toThrow()
    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    expect(fixed).toContain("We don't compromise on quality")
  })
})
