import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * #1727: sanitizeImports()'s repair for a broken multi-line `import { ... }`
 * block used a plain `.includes('}')` check for the closing brace — blind to
 * a `}` inside a trailing comment on a continuation line, same bug class as
 * #1696/#1690/#1694/#1719/#1715. Fixing that in isolation exposes a second,
 * coupled bug: once the scan no longer stops early on the comment line, it
 * runs into the next real `import` statement and discards it along with the
 * broken block instead of reprocessing it, per the issue's own repro.
 */
describe('sanitizeImports (via fixJsxErrors) — comment-blind closing-brace scan', () => {
  it('does not stop the brace scan on a } inside a trailing line comment', () => {
    const code = [
      "import {",
      "  Foo, // placeholder { for future use }",
      "  Bar",
      "} from './components/x'",
      '',
      'export default function App() { return <Foo /> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toMatch(/Foo,\s*\/\/ placeholder \{ for future use \}\s*\n\s*Bar/)
    expect(out).toMatch(/\}\s*from\s*['"]\.\/components\/x['"]/)
  })

  it('does not drop a real import that follows a broken block once the comment no longer false-closes it', () => {
    const code = [
      'import {',
      '  Foo, // placeholder { for future use }',
      "import Bar from './bar'",
      '',
      'export default function App() { return <><Foo /><Bar /></> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    // The broken outer import is genuinely unclosed and should still be discarded.
    expect(out).not.toMatch(/^import\s+\{/m)
    // But the real import that triggered the discard must survive, not be dropped.
    expect(out).toMatch(/import Bar from ['"]\.\/bar['"]/)
  })

  it('still closes a multi-line import normally when the brace is real (no regression)', () => {
    const code = [
      'import {',
      '  Foo,',
      '  Bar',
      "} from './components/x'",
      '',
      'export default function App() { return <><Foo /><Bar /></> }',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toMatch(/Foo,\s*\n\s*Bar\s*\n\}\s*from\s*['"]\.\/components\/x['"]/)
  })
})
