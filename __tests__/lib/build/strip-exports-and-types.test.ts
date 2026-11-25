import { describe, it, expect } from 'vitest'
import { stripExportsAndBasicTypes } from '@/lib/build/strip-exports-and-types'

/**
 * Real bug: app/api/preview/[id]/route.ts and app/api/preview/route.ts used
 * to run `.replace(/export\s+.../g, '')` and the `: any`/`: string`/
 * `: number`/`: boolean`/`: React.FC` type-strip regexes directly against
 * the raw, unmasked component source — a generated page's own displayed
 * copy (a quoted string or template literal showing a code snippet, or
 * ordinary text that happens to contain `: any`/`: number`/etc.) had that
 * text silently mangled alongside the real export/type-annotation syntax.
 */
describe('stripExportsAndBasicTypes', () => {
  it('strips a real top-level export default and basic TS type annotations', () => {
    const code = [
      'export default function App() {',
      '  const label: string = "hi"',
      '  const count: number = 1',
      '  const flag: any = true',
      '  return <div>{label}{count}{flag}</div>',
      '}',
    ].join('\n')
    const out = stripExportsAndBasicTypes(code)
    expect(out).not.toMatch(/export/)
    expect(out).not.toMatch(/:\s*string/)
    expect(out).not.toMatch(/:\s*number/)
    expect(out).not.toMatch(/:\s*any/)
    expect(out).toContain('function App()')
  })

  it('leaves a displayed price/FAQ string containing ": any" or ": number" untouched', () => {
    const code = [
      'function App() {',
      '  const note = "Note: any discount code applies at checkout"',
      '  const label = "Invoice #: number pending approval"',
      '  return <div>{note}{label}</div>',
      '}',
    ].join('\n')
    const out = stripExportsAndBasicTypes(code)
    expect(out).toContain('Note: any discount code applies at checkout')
    expect(out).toContain('Invoice #: number pending approval')
  })

  it('leaves a demo code snippet shown in a template literal untouched (not treated as real export syntax)', () => {
    const code = [
      'function App() {',
      '  const snippet = `export default function Example() {',
      '  return <div>Example</div>',
      '}`',
      '  return <pre>{snippet}</pre>',
      '}',
    ].join('\n')
    const out = stripExportsAndBasicTypes(code)
    expect(out).toContain('export default function Example()')
  })

  it('leaves export-shaped text inside a comment untouched', () => {
    const code = [
      '// export default function Old() { return null }',
      'function App() { return <div/> }',
    ].join('\n')
    const out = stripExportsAndBasicTypes(code)
    expect(out).toContain('// export default function Old() { return null }')
  })

  it('still strips export default even when a decoy export appears in a string earlier in the file', () => {
    const code = [
      'const note = "export default example"',
      'export default function App() { return <div>{note}</div> }',
    ].join('\n')
    const out = stripExportsAndBasicTypes(code)
    expect(out).toContain('export default example') // decoy preserved
    expect(out).toMatch(/^function App\(\)/m) // real export default stripped
  })

  // #2034/#2053/#2057/#2059/#2061/#2063/#2064-class bug ported to this
  // file's own local findStringEnd()-based maskStringsCommentsAndTemplates,
  // which never got the contraction/newline-boundary guard every other
  // masking helper in this bug class now has.
  it('still strips a real top-level "export default" that appears after a JSX-text contraction earlier in the file', () => {
    const code = [
      "function Hero() { return <p>We're building something great.</p> }",
      'export default function App() {',
      '  return <Hero />',
      '}',
    ].join('\n')
    const out = stripExportsAndBasicTypes(code)
    expect(out).not.toMatch(/export/)
    expect(out).toContain('function App()')
  })

  it('still strips a real top-level "export default" that appears after a decade-style apostrophe earlier in the file', () => {
    const code = [
      "function Hero() { return <p>Retro styles from the '90s are back.</p> }",
      'export default function App() {',
      '  return <Hero />',
      '}',
    ].join('\n')
    const out = stripExportsAndBasicTypes(code)
    expect(out).not.toMatch(/export/)
    expect(out).toContain('function App()')
  })

  /**
   * Real bug confirmed live (driftly, #2151 investigation, 2026-11-25): a
   * UNION type parameter annotation — `(id: number | string) =>`, a common
   * pattern for an id that may be numeric or a string slug — only had its
   * FIRST member stripped by the old bare `:\s*number` regex, leaving the
   * trailing `| string` fragment behind: `(id | string) =>`. That's no
   * longer a parameter annotation at all — Babel parses the parenthesized
   * expression as a bitwise-OR of two bare identifiers, and `id` loses its
   * binding as the function's own declared parameter. Every later
   * reference to `id` inside that function body then reads as a genuinely
   * undeclared variable to findUndefinedReferences()'s scope walk — surfacing
   * live as the public "This build needs another pass" page for a company
   * whose actual stored generation was valid TypeScript all along.
   */
  it('#2151 — strips a UNION type annotation completely, not just its first member', () => {
    const code = 'const deleteAudience = async (id: number | string) => {\n  return id;\n};'
    const out = stripExportsAndBasicTypes(code)
    expect(out).toBe('const deleteAudience = async (id) => {\n  return id;\n};')
    expect(out).not.toMatch(/\|/)
  })

  it('#2151 — strips a 3-member union of known basic types completely', () => {
    const code = 'const f = (x: string | number | boolean) => x;'
    const out = stripExportsAndBasicTypes(code)
    expect(out).toBe('const f = (x) => x;')
  })

  it('#2151 — a union mixing a KNOWN basic type with an unrecognized custom type is left otherwise unmangled (only the known member stripped, same as before this fix for a union it cannot safely resolve)', () => {
    const code = 'const h = (z: SomeCustomType | number) => z;'
    const out = stripExportsAndBasicTypes(code)
    // Deliberately unchanged — stripping only a member of a union this
    // function cannot fully resolve would risk leaving an equally broken
    // dangling fragment on the OTHER side; leaving it untouched is the
    // documented, safe fallback.
    expect(out).toBe(code)
  })
})
