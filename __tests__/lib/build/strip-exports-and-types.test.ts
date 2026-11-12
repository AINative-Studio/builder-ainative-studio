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
})
