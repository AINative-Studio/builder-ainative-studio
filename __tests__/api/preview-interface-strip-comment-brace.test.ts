import { describe, it, expect } from 'vitest'
import { stripTypeScriptInterfaces } from '@/app/api/preview/[id]/route'

/**
 * stripTypeScriptInterfaces — comment/string-blind depth-counting (same bug
 * family as #1633/#1637's nested-brace fix and #1690/#1691's string/
 * template-literal fix, extended here to the comment case neither of those
 * covered).
 *
 * Real bug: a `//` or `/* *\/` comment inside an `interface { ... }` body
 * containing a lone, unmatched `}` (e.g. `// deprecated, see issue }1200`)
 * was mistaken for the interface's real closing brace by the previous
 * depth-counter, which had no notion of comments. That left the rest of the
 * interface body — plus an orphan trailing `}` — dangling in the output as
 * invalid JS handed straight to this route's Babel-in-iframe transform: the
 * same "blank preview" / crash class this file's whole fix history exists
 * to prevent.
 */
describe('stripTypeScriptInterfaces — comment-blind brace (supersedes #1690/#1691 for the comment case)', () => {
  it('strips an interface whose line comment contains a stray unmatched }', () => {
    const code = `interface Props {\n  // deprecated, see issue }1200\n  theme: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('theme:')
    expect(out.trim()).toBe('function App() { return <div /> }')
  })

  it('strips an interface whose block comment contains a stray unmatched }', () => {
    const code = `interface Props {\n  /* legacy shape was } wider */\n  theme: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('theme:')
    expect(out.trim()).toBe('function App() { return <div /> }')
  })

  it('still strips an interface with a literal-type union stray } (#1690 string case, must keep working)', () => {
    const code = `interface Props {\n  variant: 'default' | 'close-}-bracket'\n  title: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('title:')
    expect(out.trim()).toBe('function App() { return <div /> }')
  })

  it('still strips a flat interface with no nested braces (control case — must keep working)', () => {
    const code = `interface Props {\n  name: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).toContain('function App() { return <div /> }')
  })

  it('still strips an interface with a nested object-type field (#1633 case, must keep working)', () => {
    const code = `interface Props {\n  theme: { primary: string; secondary: string }\n  title: string\n}\nfunction App() { return <div /> }`
    const out = stripTypeScriptInterfaces(code)
    expect(out).not.toContain('interface')
    expect(out).not.toContain('theme:')
    expect(out).not.toContain('title:')
    expect(out.trim()).toBe('function App() { return <div /> }')
  })
})
