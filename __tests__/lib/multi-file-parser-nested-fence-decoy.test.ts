import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'

/**
 * Same bug class as #2004: parseMultiFileOutput's single-page fallback (no
 * FILE markers found) used to strip markdown fences with a lazy, unanchored
 * regex that matched the FIRST "```" found anywhere as the close — including
 * a decoy ``` pair inside the real component's own JSDoc @example block —
 * discarding the real component declaration that followed it.
 */
describe('parseMultiFileOutput — single-page fallback is decoy-nested-fence-aware', () => {
  it('a JSDoc @example fenced snippet does not truncate the single-page fallback output', () => {
    const raw = [
      '```tsx',
      '/**',
      ' * @example',
      ' * ```jsx',
      ' * <InstallCommand pkg="my-sdk" />',
      ' * ```',
      ' */',
      'export default function App() {',
      '  return <div>Hello</div>',
      '}',
      '```',
    ].join('\n')

    const files = parseMultiFileOutput(raw)
    expect(files['/src/App.tsx']).toContain('export default function App')
    expect(files['/src/App.tsx']).toContain('return <div>Hello</div>')
  })
})
