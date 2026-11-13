import { describe, it, expect } from 'vitest'
import { extractCodeFromMarkdown } from '@/lib/code-validator'

/**
 * Real bug (this loop's overnight comment/string-blindness sweep):
 * extractCodeFromMarkdown()'s multi-file detection ran
 * `/\/\/\s*---\s*FILE:/.test(content)` directly against the RAW response,
 * with no awareness of a marker-shaped substring sitting inside a quoted
 * string, backtick template literal, or block comment belonging to a
 * SINGLE fenced file. A decoy there (e.g. a string literal demoing this
 * project's own multi-file convention) made a normal, single-fence
 * response take the "strip all ``` markers, return the whole response"
 * branch instead of extracting just the fenced code block — so any
 * natural-language preamble/trailing commentary around the fence rode
 * along as part of the "code" and would fail to parse, even though the
 * single file itself was perfectly valid.
 *
 * Same bug class as the already-fixed FILE_MARKER call sites in
 * flatten-multifile.ts, multi-file-parser.ts, sandbox-builder.ts and
 * extractRenderableCode (this same file) — this is extractCodeFromMarkdown's
 * own, independent call site.
 */
describe('extractCodeFromMarkdown — FILE-marker detection is comment/string-blind', () => {
  it('a decoy FILE-marker inside a single-line string literal does not trigger the multi-file branch, discarding prose around a single fence', () => {
    const raw = [
      "Here's your component:",
      '```jsx',
      'export default function App() {',
      "  const note = '// --- FILE: App.tsx'",
      '  return <div>{note}</div>',
      '}',
      '```',
      'Let me know if you want changes!',
    ].join('\n')

    const extracted = extractCodeFromMarkdown(raw)

    // Correct (single-fence) extraction: just the fenced code, no preamble/
    // trailing prose along for the ride.
    expect(extracted).not.toContain("Here's your component")
    expect(extracted).not.toContain('Let me know if you want changes')
    expect(extracted).toContain('function App')
    expect(extracted).toContain("'// --- FILE: App.tsx'")
  })

  it('a decoy FILE-marker inside a backtick template literal does not trigger the multi-file branch', () => {
    const raw = [
      'Here you go:',
      '```jsx',
      'export default function App() {',
      '  const example = `',
      '// --- FILE: src/App.tsx ---',
      'export default function App(){}',
      '`',
      '  return <pre>{example}</pre>',
      '}',
      '```',
      'Hope that helps!',
    ].join('\n')

    const extracted = extractCodeFromMarkdown(raw)

    expect(extracted).not.toContain('Here you go')
    expect(extracted).not.toContain('Hope that helps')
    expect(extracted).toContain('function App')
  })

  it('a decoy FILE-marker inside a block comment does not trigger the multi-file branch', () => {
    const raw = [
      'Sure thing:',
      '```jsx',
      '/**',
      ' * Example of our multi-file convention:',
      ' * // --- FILE: src/components/Example.tsx ---',
      ' */',
      'export default function App() {',
      '  return <div>Docs page</div>',
      '}',
      '```',
    ].join('\n')

    const extracted = extractCodeFromMarkdown(raw)

    expect(extracted).not.toContain('Sure thing')
    expect(extracted).toContain('function App')
  })

  it('still takes the multi-file branch for a real top-level FILE marker', () => {
    const raw = [
      '// --- FILE: src/App.tsx ---',
      '```jsx',
      "import Sidebar from './components/Sidebar'",
      'export default function App(){ return <Sidebar/> }',
      '```',
      '// --- FILE: src/components/Sidebar.tsx ---',
      '```jsx',
      'export default function Sidebar(){ return <aside/> }',
      '```',
    ].join('\n')

    const extracted = extractCodeFromMarkdown(raw)

    expect(extracted).toContain('// --- FILE: src/App.tsx ---')
    expect(extracted).toContain('// --- FILE: src/components/Sidebar.tsx ---')
    expect(extracted).toContain('function App')
    expect(extracted).toContain('function Sidebar')
  })

  it('single-fence content with no FILE markers at all is unaffected', () => {
    const raw = [
      '```jsx',
      'export default function App() {',
      '  return <div>Hello</div>',
      '}',
      '```',
    ].join('\n')

    const extracted = extractCodeFromMarkdown(raw)
    expect(extracted).toBe('export default function App() {\n  return <div>Hello</div>\n}')
  })
})
