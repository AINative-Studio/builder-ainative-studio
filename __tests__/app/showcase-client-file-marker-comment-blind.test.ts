import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * buildPreviewHtml()'s multi-file extraction used to call
 * `cleanCode.includes('// --- FILE:')` and a matching `cleanCode.split(...)`
 * directly against the raw, unmasked content — the same bug
 * class as #1962 (lib/code-validator.ts's extractRenderableCode), #1986
 * (lib/showcase-quality.ts's isQualityApp), #1985 (lib/build/
 * decomposition.ts's hasFileMarkers), #1981 (app/api/chat-ws/route.ts's
 * isMultiFile), and #1983 (app/api/build/repair-app/route.ts) — just a 6th,
 * independent call site none of those individual fixes covered. A single-
 * file generated app whose own text mentions this project's `// --- FILE:
 * ... ---` multi-file convention (e.g. a docs/SDK-style page demoing it
 * inside a <pre> block or a backtick template literal) has that decoy
 * mistaken for a real file boundary, so the single-file app gets wrongly
 * "split" and the showcase preview renders the wrong fragment instead of
 * the real component.
 */
describe('buildPreviewHtml FILE-marker split is comment/string-aware', () => {
  it('a decoy marker inside a template literal does not get mistaken for a real file boundary', () => {
    const code = [
      'function App() {',
      '  const docsSample = `// --- FILE: src/App.tsx ---\nexport default function Decoy(){}`',
      '  return <div>{docsSample}</div>',
      '}',
    ].join('\n')
    const html = buildPreviewHtml(code)
    // The real (only) component is App — the decoy must not cause it to be
    // split away / replaced by a bogus "file" extracted from the template.
    expect(html).toContain('function App()')
    expect(html).toContain('docsSample')
  })

  it('a decoy marker inside a block comment does not get mistaken for a real file boundary', () => {
    const code = [
      '/* Multi-file convention example:',
      '// --- FILE: src/App.tsx ---',
      'export default function Decoy(){}',
      '*/',
      'function App() { return <div>real</div> }',
    ].join('\n')
    const html = buildPreviewHtml(code)
    expect(html).toContain('function App()')
    expect(html).toContain('real')
  })

  it('a genuine multi-file blob is still split correctly (no regression)', () => {
    const code = [
      '// --- FILE: src/App.tsx ---',
      'function App() { return <div>real app</div> }',
      '// --- FILE: src/Other.tsx ---',
      'function Other() { return <div>other</div> }',
    ].join('\n')
    const html = buildPreviewHtml(code)
    expect(html).toContain('function App()')
    expect(html).toContain('real app')
  })
})
