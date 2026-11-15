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
 * #2034/#2053/#2077-class bug, found in sandbox-builder.ts's own duplicated
 * linesInsideMultilineConstruct() and its separately-vulnerable
 * maskStringsAndComments() (#2081): neither guarded against a `'`/`"` that
 * isn't really opening a string (a decade-style apostrophe, or a leading
 * quote not preceded by a word character) whose only candidate same-quote
 * close sits on a later line. That let the quote-skip jump straight past a
 * real backtick template literal or decoy `export default`/`import` line
 * that follows it on the same demo page.
 */
describe('sandbox-builder — apostrophe/newline desync in linesInsideMultilineConstruct / maskStringsAndComments (#2081)', () => {
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

  it('does not treat a FILE-marker-shaped line nested in a template literal as a real file boundary when a decade-style apostrophe precedes it', async () => {
    const code = [
      "import React from 'react'",
      "const copy = \"Styles from the '90s are back.\"",
      'const snippet = `',
      '// --- FILE: src/components/Example.tsx ---',
      'export default function Example(){}',
      '`',
      'export default function App() {',
      '  return <pre>{snippet}</pre>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain('return <pre>{snippet}</pre>')
    expect(script).toContain('// --- FILE: src/components/Example.tsx ---')
  })

  it('does not delete a decoy import-shaped line inside a template literal when a decade-style apostrophe precedes it', async () => {
    const code = [
      "const copy = \"Styles from the '90s are back.\"",
      'const demo = `',
      "import Foo from 'foo-sdk'",
      '`',
      "import React from 'react'",
      'export default function App() {',
      '  return <div>{demo}</div>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain("import Foo from 'foo-sdk'")
    expect(script).toMatch(/const demo = `\nimport Foo from 'foo-sdk'\n`/)
  })

  it('does not rewrite a decoy "export default function" inside a template literal when a decade-style apostrophe precedes it', async () => {
    const code = [
      "import React from 'react'",
      "const copy = \"Styles from the '90s are back.\"",
      'const demo = `',
      'Here is how it works:',
      'export default function MyApp() { return null }',
      '`',
      'export default function App() {',
      '  return <div>{demo}</div>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain('export default function MyApp() { return null }')
    expect(script).toContain('globalThis.App = function App')
  })

  it('still strips a real top-level import and converts a real default export — no regression', async () => {
    const code = [
      "import React from 'react'",
      "import { useState } from 'react'",
      'export default function App() {',
      '  const [x] = useState(0)',
      '  return <div>{x}</div>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).not.toMatch(/^import React from 'react'$/m)
    expect(script).toContain('globalThis.App = function App')
  })
})
