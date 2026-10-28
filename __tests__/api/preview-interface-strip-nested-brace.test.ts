// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { stripTypeScriptInterfaces } from '@/app/api/preview/[id]/route'

/**
 * stripTypeScriptInterfaces — removes `interface Name { ... }` declarations
 * from generated component source before it's handed to the Babel-in-iframe
 * preview transform and validateJavaScriptCode()'s plain-JS parser.
 *
 * Real bug: the previous flat `interface\s+\w+\s*{[^}]*}` regex stopped at
 * the FIRST `}`, which a nested object-type field or callback param type
 * contains (both idiomatic, common TSX). That left the rest of the
 * interface body — plus an orphan trailing `}` — dangling in the output as
 * invalid JS, breaking the preview with a parse error / crash instead of
 * rendering the component. Confirmed directly against the real function
 * below before the fix (`{name: null, source: 'none'}`-style silent
 * failure is NOT the shape here — this one throws a parse error downstream
 * instead, but the root cause is the identical unbalanced-brace class
 * tracked across this detector/gate family's whole fix history).
 */
describe('stripTypeScriptInterfaces', () => {
  it('strips a flat interface with no nested braces (control case — must keep working)', () => {
    const code = `interface Props {\n  name: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).toContain('function App() { return <div /> }')
  })

  it('strips an interface with a nested object-type field without leaving an orphan brace', () => {
    const code = `interface Props {\n  theme: { primary: string; secondary: string }\n  title: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('theme:')
    expect(out).not.toContain('title:')
    // The old flat regex left `  title: string\n}` dangling here — assert the
    // whole declaration (through its TRUE closing brace) is gone, and there's
    // no leftover orphan `}` immediately followed by the function.
    expect(out.trim()).toBe('function App() { return <div /> }')
  })

  it('strips an interface with a callback param carrying an object type', () => {
    const code = `interface Props {\n  onSelect: (item: { id: string }) => void\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('onSelect')
    expect(out.trim()).toBe('function App() { return <div /> }')
  })

  it('strips multiple interfaces, nested and flat, in the same file', () => {
    const code = [
      'interface A {',
      '  config: { theme: string }',
      '}',
      'interface B {',
      '  title: string',
      '}',
      'function App() { return <div /> }',
    ].join('\n')
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('config')
    expect(out).not.toContain('title')
    expect(out).toContain('function App() { return <div /> }')
  })
})
