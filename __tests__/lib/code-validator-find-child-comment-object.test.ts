import { describe, it, expect } from 'vitest'
import { findObjectRenderedAsChild } from '@/lib/code-validator'

/**
 * Regression for #1885: findObjectRenderedAsChild's SHAPE 1 check (builder#184)
 * scanned raw, unmasked file text for `const x = { ... }` to decide which
 * identifiers are object-bound. A plain (non-jsdoc) `/* ... *\/` or `//`
 * comment containing that exact shape (a stale draft, a "don't do this"
 * example) registered the name as object-bound even though it's never
 * really declared that way in the file — false-flagging otherwise valid
 * code that renders a same-named, legitimately non-object identifier
 * (e.g. a destructured prop) as a JSX child.
 */
describe('findObjectRenderedAsChild — comment-embedded object literal is not a false positive (#1885)', () => {
  it('does not flag a destructured prop rendered as a child, mentioned only in a block comment', () => {
    const code = [
      '/*',
      'const data = {',
      '  foo: 1',
      '}',
      '*/',
      "export default function App({ data }: { data: any }) {",
      '  return <div>{data}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('does not flag a same-named identifier mentioned only in a // line comment', () => {
    const code = [
      '// old approach: const data = { foo: 1 }',
      "export default function App({ data }: { data: any }) {",
      '  return <div>{data}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('still flags a REAL object literal rendered as a child even with an unrelated comment present', () => {
    const code = [
      '// unrelated note',
      'const data = { foo: 1 }',
      'export default function App() {',
      '  return <div>{data}</div>',
      '}',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBe('data')
  })
})
