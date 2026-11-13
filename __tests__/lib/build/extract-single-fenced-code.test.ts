import { describe, it, expect } from 'vitest'
import { extractSingleFencedCode } from '@/lib/build/extract-single-fenced-code'

describe('extractSingleFencedCode', () => {
  it('a JSDoc @example fenced snippet inside the real component does not swallow the rest of it', () => {
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

    const extracted = extractSingleFencedCode(raw)
    expect(extracted).toContain('export default function InstallCommand')
    expect(extracted).toContain('return <pre>npm install {pkg}</pre>')
  })

  it('strips leading/trailing prose around a single real fence', () => {
    const raw = [
      "Here's your component:",
      '```jsx',
      'export default function App() { return <div>Hi</div> }',
      '```',
      'Let me know if you want changes!',
    ].join('\n')

    expect(extractSingleFencedCode(raw)).toBe(
      'export default function App() { return <div>Hi</div> }',
    )
  })

  it('returns null when there is no fence at all', () => {
    expect(extractSingleFencedCode('export default function App() {}')).toBeNull()
  })

  it('returns null for a genuinely unclosed fence', () => {
    expect(extractSingleFencedCode('```jsx\nexport default function App() {}')).toBeNull()
  })
})
