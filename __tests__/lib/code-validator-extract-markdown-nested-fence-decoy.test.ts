import { describe, it, expect } from 'vitest'
import { extractCodeFromMarkdown } from '@/lib/code-validator'

/**
 * Same bug class as #2004 (lib/sandbox-builder.ts's stripMarkdownFence),
 * independently present in extractCodeFromMarkdown's own single-fence
 * extraction regex: a lazy, unanchored `/```lang?\n([\s\S]*?)```/` matched
 * the FIRST "```" found anywhere as the close -- including a decoy ```
 * pair sitting inside the real component's own JSDoc @example block (an
 * ordinary thing for a docs/SDK-style generated component to include) --
 * discarding the real component declaration that followed the decoy.
 */
describe('extractCodeFromMarkdown — a nested decoy fence pair no longer truncates the real code', () => {
  it('a JSDoc @example fenced snippet inside the real component does not swallow the rest of the component', () => {
    const raw = [
      '```tsx',
      '/**',
      ' * Renders the install command.',
      ' * @example',
      ' * ```jsx',
      ' * <InstallCommand pkg="my-sdk" />',
      ' * ```',
      ' */',
      'export default function InstallCommand({ pkg }) {',
      "  return <pre>npm install {pkg}</pre>",
      '}',
      '```',
    ].join('\n')

    const extracted = extractCodeFromMarkdown(raw)

    expect(extracted).toContain('export default function InstallCommand')
    expect(extracted).toContain('return <pre>npm install {pkg}</pre>')
  })

  it('leading/trailing prose around a single fence is still stripped correctly (no regression)', () => {
    const raw = [
      "Here's your component:",
      '```jsx',
      'export default function App() {',
      '  return <div>Hello</div>',
      '}',
      '```',
      'Let me know if you want changes!',
    ].join('\n')

    const extracted = extractCodeFromMarkdown(raw)

    expect(extracted).not.toContain("Here's your component")
    expect(extracted).not.toContain('Let me know if you want changes')
    expect(extracted).toBe('export default function App() {\n  return <div>Hello</div>\n}')
  })

  it('a genuinely unclosed fence falls through to the malformed-wrapper cleanup, not a crash', () => {
    const raw = '```jsx\nexport default function App() { return <div/> }'
    expect(() => extractCodeFromMarkdown(raw)).not.toThrow()
  })
})
