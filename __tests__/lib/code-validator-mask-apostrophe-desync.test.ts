import { describe, it, expect } from 'vitest'
import { sanitizeForSandpack, findDuplicateTopLevelDeclaration } from '@/lib/code-validator'

/**
 * #2034/#2053/#2055 bug class ported to code-validator.ts's own local
 * comment-masking helpers (maskCommentsPreservingLines and friends), which
 * predate lib/build/bracket-scanner.ts's shared `resolveStringOpen` guard
 * and hand-rolled the identical, unguarded quote-scan.
 *
 * Concretely: any JSX text contraction ("We're", "don't") earlier in a file
 * was wrongly treated as opening a real string literal. With no closing
 * quote on the same line (and more file content after it), the scanner kept
 * searching for ANY later same-quote character as the "close" — which could
 * be many lines away — silently un-blanking every `//`/`/* *\/` comment in
 * between. A decoy import sitting inside such a comment (#1912's own guard)
 * then survives masking, gets matched by the duplicate-import regex, and
 * causes the import-dedup pass to drop the REAL import as a "duplicate" of
 * the commented-out decoy — leaving every usage of that name with no
 * binding at all ("X is not defined" at render time).
 */
describe('code-validator: comment-mask apostrophe desync (#2034/#2053-class in local masks)', () => {
  it('does not let a JSX contraction expose a block-commented decoy import to the dedup pass', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      "  return <p>We're building something great.</p>",
      '}',
      '/*',
      "import { Real } from './decoy'",
      '*/',
      "import { Real } from './real'",
      'export default App',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)

    // The real import must survive — it must not be stripped as a
    // "duplicate" of the decoy sitting inside the block comment (which the
    // apostrophe-desync bug would otherwise leave fully unmasked, exposing
    // it to the dedup regex as if it were real code).
    expect(fixed).toContain("import { Real } from './real'")
    expect(findDuplicateTopLevelDeclaration(fixed)).toBeNull()
  })

  it('leaves a genuinely duplicate import de-duped even past an earlier contraction', () => {
    const code = [
      "import React from 'react'",
      "import { Card } from './components/ui/card'",
      "import { Card } from './components/aikit'", // genuine duplicate
      'export default function App() {',
      "  return <div><p>It's still a real duplicate below.</p><Card /></div>",
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    const cardImportLines = fixed.split('\n').filter(l => /^\s*import\s*\{\s*Card\s*\}/.test(l))
    expect(cardImportLines.length).toBe(1)
  })

  it('tolerates many contractions in JSX text without corrupting later real code', () => {
    const code = [
      "import React from 'react'",
      "import { Button } from './components/ui/button'",
      'export default function App() {',
      '  return (',
      '    <div>',
      "      <p>We're here. Don't worry. Let's go. It's fine.</p>",
      '      <Button>Click</Button>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain("import { Button } from './components/ui/button'")
    expect(fixed).toContain('<Button>Click</Button>')
  })
})
