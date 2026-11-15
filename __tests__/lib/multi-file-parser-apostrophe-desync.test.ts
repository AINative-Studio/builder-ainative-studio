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
})
