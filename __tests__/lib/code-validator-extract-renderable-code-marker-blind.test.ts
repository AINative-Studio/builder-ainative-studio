import { describe, it, expect } from 'vitest'
import { extractRenderableCode } from '@/lib/code-validator'

/**
 * #1962: extractRenderableCode() used to split raw, unmasked content on the
 * literal FILE_MARKER text directly — a 4th independent FILE_MARKER call
 * site with the same comment/string-blind bug class as #1933/#1939/#1949.
 * A decoy marker inside a backtick template literal or a block comment
 * (e.g. an SDK/docs-style landing page demoing this project's own
 * multi-file convention as example text) got mistaken for a real file
 * boundary.
 */
describe('extractRenderableCode — FILE_MARKER split is comment/string-aware (#1962)', () => {
  it('ignores a decoy FILE_MARKER sitting inside a backtick template literal', () => {
    const content = [
      "const demo = `// --- FILE: src/App.tsx ---\nconst x = 1`",
      'export default function App() { return (<div>{demo}</div>) }',
    ].join('\n')
    const extracted = extractRenderableCode(content)
    expect(extracted).toContain('export default function App')
    expect(extracted).toContain('const demo =')
  })

  it('ignores a decoy FILE_MARKER sitting inside a block comment', () => {
    const content = [
      '/* example: // --- FILE: src/App.tsx --- */',
      'export default function App() { return (<div>real</div>) }',
    ].join('\n')
    const extracted = extractRenderableCode(content)
    expect(extracted).toContain('export default function App')
    expect(extracted).toContain('real')
  })

  it('still correctly splits a genuine multi-file blob and picks App.tsx', () => {
    const content = [
      '// --- FILE: src/App.tsx ---',
      "import Foo from './Foo'",
      'export default function App() { return (<Foo/>) }',
      '// --- FILE: src/Foo.tsx ---',
      'export default function Foo() { return (<div>hi</div>) }',
    ].join('\n')
    const extracted = extractRenderableCode(content)
    expect(extracted).toContain('export default function App')
    expect(extracted).not.toContain('Foo() { return (<div>hi</div>) }')
    expect(extracted).not.toMatch(/FILE:/)
  })

  it('still picks the largest file with a component when no App.tsx is present', () => {
    const content = [
      '// --- FILE: src/Small.tsx ---',
      'export default function Small() { return (<div>x</div>) }',
      '// --- FILE: src/Big.tsx ---',
      'export default function Big() {',
      '  const items = [1, 2, 3]',
      '  return (<div>{items.map(i => <span key={i}>{i}</span>)}</div>)',
      '}',
    ].join('\n')
    const extracted = extractRenderableCode(content)
    expect(extracted).toContain('function Big')
  })

  it('a real quoted/templated string inside the chosen file survives byte-for-byte', () => {
    const content = [
      '// --- FILE: src/App.tsx ---',
      "const greeting = `Hello, ${'world'}!`",
      'export default function App() { return (<div>{greeting}</div>) }',
    ].join('\n')
    const extracted = extractRenderableCode(content)
    expect(extracted).toContain("const greeting = `Hello, ${'world'}!`")
  })
})
