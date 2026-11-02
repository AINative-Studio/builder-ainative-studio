import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * buildPreviewHtml's internal stripTypeScriptInterfaces — comment/string-
 * blind depth-counting (same bug family as #1637's nested-brace fix and
 * #1690's string/template-literal fix, extended here to the comment case
 * neither of those covered). Same fix as
 * __tests__/api/preview-interface-strip-comment-brace.test.ts for
 * app/api/preview/[id]/route.ts's sibling function.
 */
describe('buildPreviewHtml interface stripping — comment-blind brace (supersedes #1690 for the comment case)', () => {
  it('strips an interface whose line comment contains a stray unmatched }', () => {
    const code = `interface Props {\n  // deprecated, see issue }1200\n  theme: string\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
    expect(html).not.toContain('theme:')
  })

  it('strips an interface whose block comment contains a stray unmatched }', () => {
    const code = `interface Props {\n  /* legacy shape was } wider */\n  theme: string\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
    expect(html).not.toContain('theme:')
  })

  it('still strips an interface with a literal-type union stray } (#1690 string case, must keep working)', () => {
    const code = `interface Props {\n  variant: 'default' | 'close-}-bracket'\n  title: string\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
    expect(html).not.toContain('close-}-bracket')
  })

  it('still strips a flat interface with no nested braces (control case — must keep working)', () => {
    const code = `interface Props {\n  name: string\n}\nfunction App() { return <div /> }`
    const html = buildPreviewHtml(code)
    expect(html).not.toContain('interface Props')
  })
})
