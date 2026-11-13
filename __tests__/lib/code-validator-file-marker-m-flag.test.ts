import { describe, it, expect } from 'vitest'
import { findObjectRenderedAsChild, findUnresolvedComponents } from '@/lib/code-validator'

/**
 * #1967: FILE_MARKER lacked the `m` flag, so `^`/`$` anchored to the start/
 * end of the ENTIRE input rather than each line. code.split(FILE_MARKER)
 * against a real multi-file blob therefore never matched at all (the
 * marker is never the whole string), silently returning the input unsplit
 * — per-file scoping in findObjectRenderedAsChild/findUnresolvedComponents/
 * findUndefinedReferences never actually happened.
 */
describe('code-validator — FILE_MARKER actually splits multi-file content (#1967)', () => {
  it('findObjectRenderedAsChild scopes object-as-child detection per file, not across the whole blob', () => {
    const code = [
      '// --- FILE: src/App.tsx ---',
      'const data = { a: 1 }',
      'export default function App() { return (<div>App</div>) }',
      '// --- FILE: src/Foo.tsx ---',
      // `data` here is a legitimate, unrelated prop — NOT the object literal
      // from App.tsx above. Before the fix, the unsplit blob let App.tsx's
      // `const data = {...}` leak across the "boundary" into this file's
      // `{data}` render, wrongly flagging it as "Objects are not valid as a
      // React child."
      'export default function Foo({ data }: { data: string }) { return (<div>{data}</div>) }',
    ].join('\n')
    expect(findObjectRenderedAsChild(code)).toBeNull()
  })

  it('findUnresolvedComponents resets available-name scope at each real file boundary', () => {
    const code = [
      '// --- FILE: src/App.tsx ---',
      'function Helper() { return (<div>h</div>) }',
      'export default function App() { return (<Helper/>) }',
      '// --- FILE: src/Other.tsx ---',
      // `Helper` is NOT declared/imported in this file — before the fix,
      // the unsplit blob let App.tsx's local `Helper` declaration leak
      // across the boundary and mask this file's genuinely unresolved usage.
      'export default function Other() { return (<Helper/>) }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toContain('Helper')
  })
})
