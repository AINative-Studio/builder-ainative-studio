import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * #1637 — buildPreviewHtml()'s interface-stripping regex
 * (`interface\s+\w+\s*{[^}]*}`) stopped at the FIRST `}`, which a nested
 * object-type field or callback param type contains (both idiomatic in
 * generated TSX). That left the rest of the interface body — plus an
 * orphan trailing `}` — dangling in the output as invalid JS, breaking the
 * showcase preview's Babel-in-browser transform instead of rendering the
 * component. Same bug class as #1633's fix for app/api/preview/[id]/route.ts.
 */
describe('buildPreviewHtml interface stripping (#1637)', () => {
  it('strips a flat interface with no nested braces (control case — must keep working)', () => {
    const code = `interface Props {\n  name: string\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
  })

  it('strips an interface with a nested object-type field without leaving an orphan brace', () => {
    const code = `interface Props {\n  theme: { primary: string; secondary: string }\n  title: string\n}\nfunction App() { return <div>{title}</div> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
    expect(html).not.toContain('theme:')
    // The old flat regex left `  title: string\n}` dangling in the output.
    expect(html).not.toMatch(/title:\s*string\s*\}\s*\n\s*function App/)
  })

  it('strips an interface with a callback param carrying an object type', () => {
    const code = `interface Props {\n  onSelect: (item: { id: string }) => void\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
    expect(html).not.toContain('onSelect')
  })
})
