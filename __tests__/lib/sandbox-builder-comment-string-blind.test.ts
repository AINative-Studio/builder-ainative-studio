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
 * as #1933/#1939/#1931/etc.): buildRenderScript()'s import-strip and
 * `export default` rewrites, and extractMainFileContent()'s FILE_MARKER
 * scan, all ran against RAW, unmasked code with no notion of a decoy inside
 * a demo/example string, template literal, or comment — an ordinary thing
 * for a docs/SDK-style landing page to render as display text.
 */
describe('sandbox-builder — comment/string-blindness in buildRenderScript / extractMainFileContent', () => {
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

  it('does not rewrite a decoy "export default function" sitting inside a template literal used as display text', async () => {
    const code = [
      "import React from 'react'",
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
    // The demo text inside the template literal must survive untouched.
    expect(script).toContain('export default function MyApp() { return null }')
    // The REAL default export must still be converted.
    expect(script).toContain('globalThis.App = function App')
  })

  it('does not rewrite a decoy "export default" sitting inside a same-line string', async () => {
    const code = [
      "import React from 'react'",
      'const label = "export default demo"',
      'export default function App() {',
      '  return <div>{label}</div>',
      '}',
    ].join('\n')

    const result = await buildInSandbox(code)
    expect(result.success).toBe(true)

    const script = renderScriptSentToSandbox()
    expect(script).toContain('const label = "export default demo"')
    expect(script).toContain('globalThis.App = function App')
  })

  it('does not delete a decoy import-shaped line inside a template literal', async () => {
    const code = [
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
    // The template literal itself must stay terminated (closing backtick intact).
    expect(script).toMatch(/const demo = `\nimport Foo from 'foo-sdk'\n`/)
  })

  it('does not treat a FILE-marker-shaped line nested inside a template literal as a real file boundary', async () => {
    const code = [
      "import React from 'react'",
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
    // The real App component's own body must still be present (not
    // silently replaced by the decoy "Example" fragment because
    // extractMainFileContent() mistook the embedded marker for a real
    // split point).
    expect(script).toContain('return <pre>{snippet}</pre>')
    expect(script).toContain('// --- FILE: src/components/Example.tsx ---')
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
