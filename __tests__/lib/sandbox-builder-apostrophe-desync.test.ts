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
 * #2034/#2053/#2057/#2059/#2061-class bug ported to sandbox-builder.ts's own
 * local maskStringsAndComments(), which never got the contraction/newline-
 * boundary guard. buildRenderScript()'s `export default` rewrites run
 * through replaceOutsideMask(code, maskStringsAndComments(code), ...), which
 * only applies a replacement when the matched span is UNCHANGED in the
 * masked view (i.e. real code, not a decoy). A JSX-text contraction/decade-
 * apostrophe earlier in the file desynced the mask, wrongly blanking the
 * real `export default function App` text — replaceOutsideMask then sees it
 * as "inside a decoy" and skips the rewrite entirely, so `App` never gets
 * exposed on `globalThis` and the SSR preview shows "Component not found".
 */
describe('sandbox-builder — comment/string-mask apostrophe desync (#2034/#2053-class)', () => {
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

  it('still converts the real "export default function App" after a decade-style apostrophe in JSX text', async () => {
    const code = [
      "import React from 'react'",
      'function Hero() {',
      "  return <p>Retro styles from the '90s are back.</p>",
      '}',
      'export default function App() {',
      '  return <div><Hero /></div>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain('globalThis.App = function App')
  })

  it('still converts the real "export default function App" after a JSX-text contraction', async () => {
    const code = [
      "import React from 'react'",
      'function Hero() {',
      "  return <p>We're building something great. Don't worry.</p>",
      '}',
      'export default function App() {',
      '  return <div><Hero /></div>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain('globalThis.App = function App')
  })

  /**
   * Same bug class, ported to this file's SEPARATE
   * `linesInsideMultilineConstruct` helper (feeds extractMainFileContent's
   * own FILE_MARKER scan and buildRenderScript's import-strip scan — a
   * distinct function from maskStringsAndComments above, with its own
   * unguarded copy of the quote-handling branch, #2063/#2077 follow-up). A
   * JSX-text contraction earlier in the real App file's own content opens a
   * fake single-quoted string; with no newline-boundary check, the scanner
   * jumps past the real backtick template literal that hides a decoy
   * FILE-marker-shaped line, so extractMainFileContent wrongly splits the
   * App file in two at the decoy — truncating the file whose name actually
   * matches `App.tsx` and losing the real `export default function App`
   * that came after the split point.
   */
  it('still finds the real "export default function App" when a decoy marker is hidden inside a template literal after an earlier JSX-text contraction', async () => {
    const code = [
      '// --- FILE: src/App.tsx ---',
      "function Hero() { return <p>We're building something great.</p> }",
      'const docs = `',
      '// --- FILE: src/components/Decoy.tsx ---',
      '`',
      'export default function App(){ return <div><Hero/></div> }',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain('globalThis.App = function App')
  })
})
