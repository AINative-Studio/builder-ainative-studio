import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real bug found live this run (issue #1983): POST /api/build/repair-app's
 * re-split of the LLM-repaired code for storeFiles() gated on
 * `result.code.includes('// --- FILE:')` and then split the raw code on
 * the unmasked `// --- FILE:` marker pattern directly — the marker regex
 * isn't even anchored to a full
 * line, so a marker-shaped substring ANYWHERE (including inside a
 * single-line string literal) triggers it. Same decoy class #1933/#1939/
 * #1945/#1949/#1962/#1977/#1978 independently found and fixed in this
 * codebase's other FILE-marker scans — this route's own re-split is an
 * independent, additional call site (distinct from extractRenderableCode's
 * own version of this bug, #1962/PR #1965).
 *
 * Fixed by splitOnRealFileMarkers()/maskStringsAndBlockCommentsForFileMarkerScan(),
 * the same fix shape as lib/code-validator.ts's extractRenderableCode fix.
 *
 * Extracts and executes the real function bodies (not a reimplementation)
 * from the route source, same technique PR #1881's _tailwindStyleInjected
 * test and the chat-ws-file-marker-decoy test use, since this route file
 * has top-level side-effecting module state (an OpenAI client construction)
 * unsafe to trigger by importing the whole module in a plain unit test.
 */
describe('repair-app route FILE-marker re-split is comment/string-aware, not a blind .split() (#1983)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/build/repair-app/route.ts'), 'utf8')

  function loadHelpers(): { splitOnRealFileMarkers: (code: string) => string[] } {
    const start = source.indexOf('function maskStringsAndBlockCommentsForFileMarkerScan(content: string): string {')
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\nexport async function POST(')
    expect(end).toBeGreaterThan(start)
    const body = source
      .slice(start, end)
      .replace(/function maskStringsAndBlockCommentsForFileMarkerScan\(content: string\): string \{/, 'function maskStringsAndBlockCommentsForFileMarkerScan(content) {')
      .replace(/function splitOnRealFileMarkers\(content: string\): string\[\] \{/, 'function splitOnRealFileMarkers(content) {')
      .replace(/const parts: string\[\] = \[\]/, 'const parts = []')
      .replace(/let m: RegExpExecArray \| null/, 'let m')
    const fn = new Function(`${body}\nreturn { splitOnRealFileMarkers };`)
    return fn()
  }

  it('the route no longer gates the re-split on a raw .includes()/.split() of the unmasked code', () => {
    expect(source).not.toMatch(/result\.code\.includes\('\/\/ --- FILE:'\)/)
    expect(source).not.toMatch(/result\.code\.split\(\/\\\/\\\/\\s\*---\\s\*FILE:\\s\*\/i\)/)
    expect(source).toMatch(/const fileParts = splitOnRealFileMarkers\(result\.code\)/)
    expect(source).toMatch(/if \(fileParts\.length > 1\)/)
  })

  it('a decoy marker inside a single-line string does not split genuinely single-file repaired code', () => {
    const { splitOnRealFileMarkers } = loadHelpers()
    const decoy = "import React from 'react'\nconst note = '// --- FILE: App.tsx'\nexport default function App() { return null }"
    expect(splitOnRealFileMarkers(decoy).length).toBe(1)
  })

  it('a decoy marker inside a block comment does not split genuinely single-file repaired code', () => {
    const { splitOnRealFileMarkers } = loadHelpers()
    const decoy = [
      '/**',
      ' * Elsewhere we use the // --- FILE: path/to/file.tsx --- convention.',
      ' */',
      'export default function App() { return null }',
    ].join('\n')
    expect(splitOnRealFileMarkers(decoy).length).toBe(1)
  })

  it('a decoy marker inside a template literal does not split genuinely single-file repaired code', () => {
    const { splitOnRealFileMarkers } = loadHelpers()
    const decoy = [
      'export default function App() {',
      '  const docs = `',
      '// --- FILE: path/to/file.tsx ---',
      '  `',
      '  return docs',
      '}',
    ].join('\n')
    expect(splitOnRealFileMarkers(decoy).length).toBe(1)
  })

  it('still splits real multi-file markers correctly', () => {
    const { splitOnRealFileMarkers } = loadHelpers()
    const real = '// --- FILE: src/App.tsx ---\nexport default function App(){ return null }\n// --- FILE: src/components/Sidebar.tsx ---\nexport default function Sidebar(){ return null }'
    const parts = splitOnRealFileMarkers(real).filter(Boolean)
    expect(parts.length).toBe(2)
    expect(parts[0]).toMatch(/^src\/App\.tsx/)
    expect(parts[1]).toMatch(/^src\/components\/Sidebar\.tsx/)
  })
})
