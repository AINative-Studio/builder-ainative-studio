// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { stripTypeScriptInterfaces } from '@/app/api/preview/[id]/route'

/**
 * stripTypeScriptInterfaces's findMatchingBrace depth-counter had no notion
 * of string/template-literal content. A literal-type union member
 * containing a lone, unmatched `}` (e.g. `variant: 'default' | 'close-}-
 * bracket'`) got mistaken for the interface's real closing brace, leaving
 * dangling invalid JS behind — the same "blank preview" crash class this
 * file's whole fix history exists to prevent (see
 * preview-interface-strip-nested-brace.test.ts for the sibling nested-brace
 * fix). Same bug class as #1654/#1675/#1686's findMatchingParen fixes,
 * applied here to this file's findMatchingBrace.
 */
describe('stripTypeScriptInterfaces — string/template-literal stray brace', () => {
  it('strips an interface whose literal-type union contains a stray }', () => {
    const code = `interface Props {\n  variant: 'default' | 'close-}-bracket'\n  title: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('variant:')
    expect(out).not.toContain('title:')
    expect(out.trim()).toBe('function App() { return <div /> }')
  })

  it('strips an interface whose template-literal default contains a stray }', () => {
    const code = 'interface Props {\n  label: string\n}\nfunction App() { return <div>{`Status: }`}</div> }'
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('label:')
    expect(out).toContain('function App() { return <div>{`Status: }`}</div> }')
  })

  it('still strips a flat interface with no string content (no regression)', () => {
    const code = `interface Props {\n  name: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out.trim()).toBe('function App() { return <div /> }')
  })
})
