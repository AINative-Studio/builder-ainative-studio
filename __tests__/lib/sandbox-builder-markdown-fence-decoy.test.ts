import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRunSequence = vi.fn()
const mockIsE2BEnabled = vi.fn()

vi.mock('@/lib/build/e2b-sandbox', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/e2b-sandbox')>('@/lib/build/e2b-sandbox')
  return {
    ...actual,
    runSequenceInE2BSandbox: (...args: any[]) => mockRunSequence(...args),
    isE2BEnabled: (...args: any[]) => mockIsE2BEnabled(...args),
  }
})

import { buildInSandbox } from '@/lib/sandbox-builder'

/**
 * Real bug found live (overnight comment/string-blindness sweep, same class
 * as #1933/#1939/#1949's fixes to this file's FILE_MARKER/import-strip/
 * export-default scans — stripMarkdownFence's own unanchored fence match was
 * not covered by that pass): stripMarkdownFence() used to match the FIRST
 * ``` ... ``` pair ANYWHERE in the raw string, not just one wrapping the
 * whole thing. A generated component's own JSDoc `@example` block — an
 * ordinary thing for a docs/SDK-style landing page component to include —
 * contains exactly such a pair with real newlines (block comments span real
 * newlines), so the unanchored match captured ONLY the demo snippet between
 * them and silently discarded the entire real component declaration around
 * it, corrupting what reaches the SSR render script.
 */
describe('sandbox-builder — stripMarkdownFence is blind to a decoy fence pair inside a JSDoc comment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: { 'output.html': '<div>ok</div>' },
    })
  })

  function renderScriptSentToSandbox(): string {
    const filesArg = mockRunSequence.mock.calls[0][0]
    return filesArg['render.jsx'] as string
  }

  it('does not let a JSDoc @example fenced snippet swallow the real component declaration', async () => {
    const code = [
      '/**',
      ' * Renders the install command.',
      ' * @example',
      ' * ```jsx',
      ' * <InstallCommand pkg="my-sdk" />',
      ' * ```',
      ' */',
      'export default function InstallCommand({ pkg }) {',
      '  return <pre>npm install {pkg}</pre>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    // The real component's own body must survive — not be replaced by the
    // one-line demo snippet quoted inside the JSDoc comment above it.
    expect(script).toContain('npm install')
    expect(script).toContain('InstallCommand')
  })

  it('still strips a REAL wrapping fence around the whole response', async () => {
    const code = '```jsx\nexport default function App() { return <div>Hi</div> }\n```'

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain('<div>Hi</div>')
    expect(script).not.toContain('```')
  })
})
