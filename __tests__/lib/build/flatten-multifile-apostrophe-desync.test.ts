import { describe, it, expect } from 'vitest'
import { parseFiles, flattenMultiFile } from '@/lib/build/flatten-multifile'

/**
 * #2034/#2053/#2057/#2059/#2061-class bug ported to flatten-multifile.ts's
 * own local findStringEnd()-based scans (linesInsideMultilineConstruct and
 * maskStringsAndComments), neither of which had the contraction/newline-
 * boundary guard.
 *
 * linesInsideMultilineConstruct feeds parseFiles()'s FILE_MARKER scan: a
 * JSX-text contraction/decade-apostrophe earlier in a file desynced the
 * scanner, which then jumped `i` forward to whatever quote character
 * happened to appear next — possibly skipping straight past a real
 * backtick/block-comment open it should have registered as a multi-line
 * construct, so a `// --- FILE: ... ---`-shaped line genuinely sitting
 * inside one is wrongly treated as a real split point, corrupting the file
 * it actually belongs to.
 */
describe('flatten-multifile: comment/string-mask apostrophe desync (#2034/#2053-class)', () => {
  it('does not split on a FILE-marker-shaped line nested inside a template literal, even after a decade-style apostrophe', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      "import Hero from './components/Hero'",
      'export default function App(){ return (<div><Hero/></div>) }',
      '// --- FILE: src/components/Hero.tsx ---',
      "function Hero() { return <p>Retro styles from the '90s are back.</p> }",
      'const snippet = `',
      '// --- FILE: src/components/Decoy.tsx ---',
      'export default function Decoy(){}',
      '`',
      'export default Hero',
    ].join('\n')

    const files = parseFiles(raw)
    expect(Object.keys(files).length).toBe(2)
    expect(files['src/components/Hero.tsx']).toContain('const snippet = `')
    expect(files['src/components/Hero.tsx']).toContain('// --- FILE: src/components/Decoy.tsx ---')
  })

  it('inlines a sibling correctly when the App file contains a JSX-text contraction before the import', () => {
    const multi = [
      '// --- FILE: src/App.tsx ---',
      "import Header from './components/Header'",
      'export default function App(){',
      "  return (<div><p>We're building something great.</p><Header/></div>)",
      '}',
      '// --- FILE: src/components/Header.tsx ---',
      'export default function Header(){ return <header>Brand</header> }',
    ].join('\n')

    const out = flattenMultiFile(multi)
    expect(out).toContain('function App')
    expect(out).toContain('function Header')
    expect(out).not.toMatch(/import\s+\w+\s+from\s*['"]\.\.?\//)
  })
})
