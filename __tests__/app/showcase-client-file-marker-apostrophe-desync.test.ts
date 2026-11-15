import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * #2064-class bug (same root class as #2034/#2053/#2057/#2059/#2061/#2063):
 * showcase-client.tsx's own maskStringsAndBlockCommentsOnly() — which feeds
 * buildPreviewHtml()'s FILE_MARKER split, see
 * showcase-client-file-marker-comment-blind.test.ts for that fix's own
 * history — used the raw findStringEnd() with no apostrophe/newline-boundary
 * guard.
 *
 * A JSX-text contraction or decade-style apostrophe ("We're building...",
 * "the '90s") anywhere earlier in a generated page's real content desyncs
 * the mask: with no other `'` character anywhere later in the file, the old
 * findStringEnd() returns -1 ("no close found"), and the old code treated
 * that as "mask everything from here to EOF" — silently blanking every REAL
 * `// --- FILE:` marker that follows in the MASKED copy the split regex
 * tests against (cleanCode itself is untouched, only the masked copy used
 * for marker detection). The split regex then never matches, so
 * buildPreviewHtml() never splits the file at all: the genuinely multi-file
 * blob (all files concatenated, including a second/other file's code) is
 * passed straight through as if it were single-file, instead of extracting
 * only the real App file.
 */
describe('buildPreviewHtml FILE-marker split survives an ordinary apostrophe earlier in the file', () => {
  it('a JSX-text contraction earlier in the file does not hide the real FILE markers that follow, so a genuinely multi-file blob still gets split', () => {
    const code = [
      "function Hero() { return <p>We're building something great.</p> }",
      '// --- FILE: src/App.tsx ---',
      'function App() { return <><Hero /><div>real app</div></> }',
      '// --- FILE: src/Other.tsx ---',
      'function Other() { return <div>other file</div> }',
    ].join('\n')
    const html = buildPreviewHtml(code)
    expect(html).toContain('function App()')
    expect(html).toContain('real app')
    // The split must still happen — Other's file content must not leak into
    // the extracted App-only output.
    expect(html).not.toContain('function Other')
    expect(html).not.toContain('other file')
  })

  it('a decade-style apostrophe earlier in the file does not hide the real FILE markers that follow, so a genuinely multi-file blob still gets split', () => {
    const code = [
      "function Hero() { return <p>Retro styles from the '90s are back.</p> }",
      '// --- FILE: src/App.tsx ---',
      'function App() { return <><Hero /><div>real app</div></> }',
      '// --- FILE: src/Other.tsx ---',
      'function Other() { return <div>other file</div> }',
    ].join('\n')
    const html = buildPreviewHtml(code)
    expect(html).toContain('function App()')
    expect(html).toContain('real app')
    expect(html).not.toContain('function Other')
    expect(html).not.toContain('other file')
  })

  it('a genuine decoy marker inside a template literal, after an unrelated earlier apostrophe, is still correctly hidden (no regression)', () => {
    const code = [
      "function Hero() { return <p>Retro styles from the '90s are back.</p> }",
      '  const docsSample = `// --- FILE: src/App.tsx ---\nexport default function Decoy(){}`',
      'function App() { return <><Hero /><div>{docsSample}</div></> }',
    ].join('\n')
    const html = buildPreviewHtml(code)
    expect(html).toContain('function App()')
    expect(html).toContain('docsSample')
  })
})
