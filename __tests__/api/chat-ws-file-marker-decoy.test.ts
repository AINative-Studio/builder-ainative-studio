import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real bug found live this run (issue #1981): chat-ws's own
 * `isMultiFile`/`multi`/`decMultiFile`/`usedMultiFile` detection (5 call
 * sites feeding closePrimitiveComplianceGap's retry-shape choice, the
 * combined fix+split branch's adoption check, the decomposition-pass
 * adoption check, and the ZeroMemory quality proxy) all `.test()`ed the
 * raw, unmasked generated code directly against
 * `/\/\/\s*---\s*FILE:/` — the exact same decoy class #1933/#1945/#1962/
 * #1977/#1978 independently found and fixed in this codebase's OTHER
 * FILE-marker scans. A model-written comment or template literal that
 * merely documents this project's own marker convention (an ordinary
 * thing to generate when the founder's idea is itself a docs/code-sharing
 * product) was mistaken for a real marker on genuinely single-file code.
 *
 * Fixed by `hasRealFileMarker()`, which reuses the
 * `linesInsideMultilineConstruct` technique already proven in
 * sandbox-builder.ts/multi-file-parser.ts: a line hidden inside an
 * earlier line's own still-open backtick template literal or block
 * comment is never treated as a real marker line.
 *
 * Extracts and executes the real function bodies (not a reimplementation)
 * from the route source, same technique PR #1881's
 * _tailwindStyleInjected test uses, since this route file has heavy
 * top-level imports (OpenAI, Sentry, next-auth) unsafe to import directly
 * in a unit test.
 */
describe('chat-ws FILE-marker detection is comment/string-aware, not a blind .test() (#1981)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  function loadHasRealFileMarker(): (code: string) => boolean {
    const helperStart = source.indexOf('function linesInsideMultilineConstruct(code: string): Set<number> {')
    expect(helperStart).toBeGreaterThan(-1)
    const nextFnAfterBoth = source.indexOf('\n/**\n * Real gap found live (issue #624,')
    expect(nextFnAfterBoth).toBeGreaterThan(helperStart)
    const body = source.slice(helperStart, nextFnAfterBoth)
      // Strip TS-only annotations so this runs as plain JS via `new Function`.
      .replace(/function linesInsideMultilineConstruct\(code: string\): Set<number> \{/, 'function linesInsideMultilineConstruct(code) {')
      .replace('new Set<number>()', 'new Set()')
      .replace(/\(from: number, to: number, line: number\): number =>/, '(from, to, line) =>')
      .replace(/function hasRealFileMarker\(code: string\): boolean \{/, 'function hasRealFileMarker(code) {')
    const fn = new Function(`${body}\nreturn hasRealFileMarker;`)
    return fn()
  }

  it('all 5 call sites use hasRealFileMarker(), not a raw unmasked .test()', () => {
    const needle = 'FILE:/.test('
    const occurrences = source.split(needle).length - 1
    // The only remaining literal occurrence of this exact substring must be
    // inside hasRealFileMarker's own mask-aware implementation.
    expect(occurrences).toBe(1)
    const idx = source.indexOf(needle)
    const nearby = source.slice(Math.max(0, idx - 200), idx)
    expect(nearby).toMatch(/hidden\.has\(i\)/)

    expect(source).toMatch(/isMultiFile = hasRealFileMarker\(current\)/)
    expect(source).toMatch(/isMultiFile && !hasRealFileMarker\(validated\.code\)/)
    expect(source).toMatch(/const multi = hasRealFileMarker\(v\.code \|\| ''\)/)
    expect(source).toMatch(/const decMultiFile = hasRealFileMarker\(decValidation\.code \|\| ''\)/)
    expect(source).toMatch(/const usedMultiFile = hasRealFileMarker\(served\)/)
  })

  it('treats a real top-level `// --- FILE:` marker as present', () => {
    const hasRealFileMarker = loadHasRealFileMarker()
    const multi = '// --- FILE: src/App.tsx ---\nexport default function App() { return null }\n'
    expect(hasRealFileMarker(multi)).toBe(true)
  })

  it('does NOT treat a decoy marker inside a block comment as a real marker', () => {
    const hasRealFileMarker = loadHasRealFileMarker()
    const decoy = [
      '/**',
      ' * Elsewhere in this app, multi-file output uses the',
      ' * // --- FILE: path/to/file.tsx --- ',
      ' * marker format, but this file is single-file.',
      ' */',
      'import React from "react"',
      'export default function App() { return <div>Hello</div> }',
      '',
    ].join('\n')
    expect(hasRealFileMarker(decoy)).toBe(false)
  })

  it('does NOT treat a decoy marker inside a template literal as a real marker', () => {
    const hasRealFileMarker = loadHasRealFileMarker()
    const decoy = [
      'export default function App() {',
      '  const docs = `Our convention:',
      '// --- FILE: path/to/file.tsx ---',
      '  `',
      '  return <pre>{docs}</pre>',
      '}',
      '',
    ].join('\n')
    expect(hasRealFileMarker(decoy)).toBe(false)
  })

  it('still finds a real marker that appears AFTER a decoy-containing comment', () => {
    const hasRealFileMarker = loadHasRealFileMarker()
    const mixed = [
      '/* mentions // --- FILE: decoy.tsx --- inside a comment */',
      '// --- FILE: src/App.tsx ---',
      'export default function App() { return null }',
    ].join('\n')
    expect(hasRealFileMarker(mixed)).toBe(true)
  })
})
