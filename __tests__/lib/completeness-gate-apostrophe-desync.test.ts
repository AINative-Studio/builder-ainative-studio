import { describe, it, expect } from 'vitest'
import { findUndeclaredJsxComponents } from '@/lib/build/completeness-gate'

/**
 * #2034/#2053/#2057/#2061-class bug ported to completeness-gate.ts's own
 * linesInsideMultilineConstruct() (feeds splitMarkerBlob()'s FILE_MARKER
 * scan) — the exact twin of flatten-multifile.ts's identically-named
 * function, already fixed for this bug class, but completeness-gate.ts's
 * own copy (imported the shared, UNGUARDED bracket-scanner findStringEnd()
 * directly) never got the same guard.
 *
 * A JSX-text decade-style apostrophe ("the '90s") earlier in a file desyncs
 * the scan: with no apostrophe guard, findStringEnd() finds no further `'`
 * in the rest of the file and treats everything from the apostrophe to EOF
 * as "inside a string" — so the real backtick template literal a few lines
 * later never gets marked a multi-line construct, and a `// --- FILE: ...
 * ---`-shaped line genuinely sitting inside that template literal is
 * wrongly treated as a real file boundary by splitMarkerBlob(). That splits
 * one real component file into two bogus ones, separating a component's
 * declaration from its own usage of another component declared earlier in
 * the same real file — surfacing as a false "undeclared JSX component".
 */
describe('completeness-gate: comment/string-mask apostrophe desync (#2034/#2053-class)', () => {
  it('does not split a file on a FILE-marker-shaped line nested inside a template literal, even after a decade-style apostrophe', () => {
    const code = [
      '// --- FILE: src/components/Hero.tsx ---',
      "function Badge() { return <span>Retro vibes from the '90s</span> }",
      'const snippet = `',
      '// --- FILE: src/components/Decoy.tsx ---',
      'this text is just display content, not a real file boundary',
      '`',
      'export default function Hero() { return <Badge/> }',
    ].join('\n')

    // Badge is declared and used within the SAME real file — a correct
    // split must never separate them, so this must report no undeclared
    // components.
    expect(findUndeclaredJsxComponents(code)).toEqual([])
  })
})
