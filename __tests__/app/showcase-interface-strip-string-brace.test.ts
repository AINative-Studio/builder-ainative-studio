import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * buildPreviewHtml()'s local stripTypeScriptInterfaces() shared the same
 * string/template-literal-blind findMatchingBrace gap fixed in
 * app/api/preview/[id]/route.ts (see
 * preview-interface-strip-string-brace.test.ts) — a literal-type union
 * member containing a stray, unmatched `}` got mistaken for the interface's
 * real closing brace, leaving dangling invalid JS in the showcase preview's
 * Babel-in-browser input.
 */
describe('buildPreviewHtml interface stripping — string/template-literal stray brace', () => {
  it('strips an interface whose literal-type union contains a stray }', () => {
    const code = `interface Props {\n  variant: 'default' | 'close-}-bracket'\n  label: string\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
    expect(html).not.toContain('variant:')
    expect(html).not.toContain('close-}-bracket')
    expect(html).not.toContain('label:')
  })

  it('strips a flat interface with no string content (no regression)', () => {
    const code = `interface Props {\n  name: string\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
  })
})
