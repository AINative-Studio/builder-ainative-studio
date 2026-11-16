import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'

/**
 * #2034/#2053/#2057/#2059/#2061-class bug ported to multi-file-parser.ts's
 * own local maskCommentsAndStrings() (injectMissingImports' masking pass),
 * which never got the contraction/newline-boundary guard
 * lib/sandpack/build-files.ts's sibling function already has.
 *
 * A JSX-text contraction/decade-apostrophe anywhere before a real shadcn/
 * AIKit/lucide-react JSX usage made the mask treat it as a real string
 * open, searched forward for the next same-quote character (often many
 * lines away), and blanked everything in between as if it were string
 * content — hiding the real usage from every "already imported"/"is used"
 * check below, so the component's import never gets injected at all
 * ("X is not defined" at render).
 */
describe('multi-file-parser: comment/string-mask apostrophe desync (#2034/#2053-class)', () => {
  it('still injects a missing lucide icon import for JSX usage after a decade-style apostrophe', () => {
    const raw = [
      "import React from 'react'",
      'function Hero() {',
      "  return <p>Retro styles from the '90s are back.</p>",
      '}',
      'export default function App() {',
      '  return <div><Hero /><Search/></div>',
      '}',
    ].join('\n')

    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(app).toMatch(/import\s*\{[^}]*\bSearch\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
  })

  it('still injects a missing lucide icon import for JSX usage after a JSX-text contraction', () => {
    const raw = [
      "import React from 'react'",
      'function Hero() {',
      "  return <p>We're building something great. Don't worry.</p>",
      '}',
      'export default function App() {',
      '  return <div><Hero /><Bell/></div>',
      '}',
    ].join('\n')

    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(app).toMatch(/import\s*\{[^}]*\bBell\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
  })

  /**
   * Same bug class, ported to this file's SEPARATE
   * `linesInsideMultilineConstruct` helper (feeds parseMultiFileOutput's own
   * FILE_MARKER scan, not injectMissingImports' maskCommentsAndStrings — a
   * distinct function with its own unguarded copy of the quote-handling
   * branch, #2063/#2077 follow-up). A JSX-text contraction earlier in a
   * file's content opens a fake single-quoted string; with no newline-
   * boundary check, the scanner jumps `i` past the real backtick template
   * literal that hides the decoy marker below, so the span inside it is
   * never registered as "inside a multi-line construct" and the decoy is
   * wrongly split out as if it were a real file boundary.
   */
  it('does not split on a decoy FILE marker hidden inside a template literal, even after an earlier JSX-text contraction', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      "import Hero from './components/Hero'",
      'export default function App(){ return (<div><Hero/></div>) }',
      '// --- FILE: src/components/Hero.tsx ---',
      "function Hero() { return <p>We're building something great.</p> }",
      'const docs = `',
      '// --- FILE: src/components/Decoy.tsx ---',
      'export default function Decoy(){}',
      '`',
      'export default Hero',
    ].join('\n')

    const files = parseMultiFileOutput(raw)
    expect(files['/src/components/Decoy.tsx']).toBeUndefined()
    expect(files['/src/components/Hero.tsx']).toContain('const docs = `')
    expect(files['/src/components/Hero.tsx']).toContain('// --- FILE: src/components/Decoy.tsx ---')
  })
})
