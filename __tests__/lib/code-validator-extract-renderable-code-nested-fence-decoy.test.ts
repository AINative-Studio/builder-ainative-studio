import { describe, it, expect } from 'vitest'
import { extractRenderableCode } from '@/lib/code-validator'

/**
 * Same bug class as #2004/#2008: extractRenderableCode's markdown-code-block
 * fallback used a lazy, unanchored /```lang?\n([\s\S]*?)```/ regex that
 * matched the FIRST "```" found anywhere as the close — including a decoy
 * ``` pair inside the real component's own JSDoc @example block — discarding
 * the real component declaration that followed it.
 */
describe('extractRenderableCode — single-fence markdown block is decoy-nested-fence-aware', () => {
  it('a JSDoc @example fenced snippet does not truncate the extracted code', () => {
    const raw = [
      '```tsx',
      '/**',
      ' * @example',
      ' * ```jsx',
      ' * <InstallCommand pkg="my-sdk" />',
      ' * ```',
      ' */',
      'export default function InstallCommand({ pkg }) {',
      '  return <pre>npm install {pkg}</pre>',
      '}',
      '```',
    ].join('\n')

    const extracted = extractRenderableCode(raw)
    expect(extracted).toContain('export default function InstallCommand')
    expect(extracted).toContain('return <pre>npm install {pkg}</pre>')
  })
})
