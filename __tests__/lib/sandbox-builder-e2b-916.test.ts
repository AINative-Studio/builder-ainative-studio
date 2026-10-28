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

const REAL_HTML = '<div class="app"><h1>Hello Founder</h1></div>'

const SIMPLE_COMPONENT = `
export default function App() {
  return <div className="app"><h1>Hello Founder</h1></div>
}
`

describe('buildInSandbox — E2B-isolated SSR render (#916)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an honest failure (never a crash or the dead Railway call) when E2B is not configured', async () => {
    mockIsE2BEnabled.mockReturnValue(false)

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(mockRunSequence).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.html).toBe('')
    expect(result.error).toBeTruthy()
    expect(typeof result.buildTimeMs).toBe('number')
  })

  it('SSR renders a real component via E2B and returns self-contained HTML', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: { 'output.html': REAL_HTML },
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(mockRunSequence).toHaveBeenCalledOnce()
    expect(result.success).toBe(true)
    expect(result.html).toContain(REAL_HTML)
    expect(result.html).toContain('<!DOCTYPE html>')
    expect(result.html).toContain('tailwindcss.com')
    expect(result.error).toBeUndefined()
    expect(typeof result.buildTimeMs).toBe('number')
  })

  it('strips a markdown code fence before sending the component into the sandbox', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: { 'output.html': REAL_HTML },
    })

    const fenced = '```tsx\n' + SIMPLE_COMPONENT + '\n```'
    const result = await buildInSandbox(fenced)

    expect(result.success).toBe(true)
    const [, , options] = mockRunSequence.mock.calls[0]
    // The files map passed to the sandbox should not still contain the fence markers.
    const filesArg = mockRunSequence.mock.calls[0][0]
    const writtenSource = Object.values(filesArg).find((v) => typeof v === 'string' && (v as string).includes('Hello Founder'))
    expect(writtenSource).toBeDefined()
    expect(writtenSource).not.toContain('```')
  })

  it('degrades to {success:false} when sandbox creation itself fails', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [],
      files: {},
      sandboxError: 'quota exceeded',
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.html).toBe('')
    expect(result.error).toMatch(/quota exceeded/)
  })

  it('degrades to {success:false} when the render command exits non-zero', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 1, stdout: '', stderr: 'ReferenceError: X is not defined', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.html).toBe('')
    expect(result.error).toBeTruthy()
  })

  it('degrades to {success:false} when the render command times out', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: null, stdout: '', stderr: '', timedOut: true },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timed out/i)
  })

  it('degrades to {success:false} when the install step fails', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 1, stdout: '', stderr: 'ENOTFOUND registry.npmjs.org', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('reports a timeout-specific reason when the install step itself times out', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: null, stdout: '', stderr: '', timedOut: true },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/npm install timed out/)
  })

  it('degrades to {success:false} when the install step succeeds but no render result exists at all', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/did not produce a result/)
  })

  it('degrades to {success:false} when the render step reported success but produced no readable output file', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('degrades to {success:false} instead of throwing when runSequenceInE2BSandbox itself rejects', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockRejectedValue(new Error('unexpected SDK failure'))

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unexpected SDK failure/)
  })

  it('never references the dead Railway host anywhere in the source file', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/sandbox-builder.ts'), 'utf8')
    expect(src).not.toContain('amusing-curiosity')
    expect(src).not.toContain('SANDBOX_EXECUTOR_URL')
  })

  it('detects a non-default export component name and still renders successfully', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: { 'output.html': '<section>Dashboard</section>' },
    })

    const namedComponent = `
export default function FounderDashboard() {
  return <section>Dashboard</section>
}
`
    const result = await buildInSandbox(namedComponent)
    expect(result.success).toBe(true)
    expect(result.html).toContain('Dashboard')
  })

  describe('raw multi-file generator output (// --- FILE: ... ---)', () => {
    // chat-ws/route.ts passes `finalContent` into buildInSandbox() with no
    // multi-file check — it can be the raw `// --- FILE: ... ---` blob the
    // generator actually produces, not a single file's code.
    const MULTI_FILE_SIBLING_FIRST = `// --- FILE: src/components/Sidebar.tsx ---
export default function Sidebar() {
  return <aside>Nav</aside>
}

// --- FILE: src/App.tsx ---
export default function App() {
  return <div><h1>Real Founder App</h1></div>
}
`

    function renderScriptSentToSandbox(): string {
      const filesArg = mockRunSequence.mock.calls[0][0]
      return filesArg['render.jsx']
    }

    it('picks the App file\'s own component, not a sibling that appears earlier in the raw blob', async () => {
      mockIsE2BEnabled.mockReturnValue(true)
      mockRunSequence.mockResolvedValue({
        commandResults: [
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        ],
        files: { 'output.html': '<div><h1>Real Founder App</h1></div>' },
      })

      const result = await buildInSandbox(MULTI_FILE_SIBLING_FIRST)

      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      // The render script must look for the real root component...
      expect(script).toContain(`globalThis['App']`)
      // ...and must never have shipped the sibling's own code at all (the
      // old behavior rendered this fragment instead of the real App). Not a
      // bare `.not.toContain('Sidebar')` -- the stub boilerplate below
      // legitimately contains 'AIKitSidebar'.
      expect(script).not.toContain('globalThis.Sidebar')
      expect(script).not.toContain('<aside>Nav</aside>')
    })

    it('leaves genuinely single-file output (no FILE markers) completely unchanged', async () => {
      mockIsE2BEnabled.mockReturnValue(true)
      mockRunSequence.mockResolvedValue({
        commandResults: [
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        ],
        files: { 'output.html': REAL_HTML },
      })

      await buildInSandbox(SIMPLE_COMPONENT)

      const script = renderScriptSentToSandbox()
      expect(script).toContain(`globalThis['App']`)
    })
  })

  describe('bare `export { Name }` list export with no `export default` (#1541-class gap)', () => {
    // shadcn/ui's own canonical convention: declare, then export via a
    // trailing bare list. Neither the old detectComponentName() regex nor
    // the export-default globalThis conversion in buildRenderScript() could
    // see this at all -- the component would resolve to `null` at render
    // time ("Component not found"), not a crash, so this needs a script
    // inspection to catch (the mocked E2B result always reports success).
    const BARE_EXPORT_ONLY = `
function LandingPage() {
  return <div className="app"><h1>Hello Founder</h1></div>
}

export { LandingPage }
`

    function renderScriptSentToSandbox(): string {
      const filesArg = mockRunSequence.mock.calls[0][0]
      return filesArg['render.jsx']
    }

    it('detects the real declared name and exposes it on globalThis, not the "App" fallback', async () => {
      mockIsE2BEnabled.mockReturnValue(true)
      mockRunSequence.mockResolvedValue({
        commandResults: [
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        ],
        files: { 'output.html': REAL_HTML },
      })

      const result = await buildInSandbox(BARE_EXPORT_ONLY)

      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      expect(script).toContain(`globalThis['LandingPage']`)
      // The real bug: pre-fix, the component name fell back to the
      // hardcoded 'App', which this file never declares at all.
      expect(script).toContain("typeof LandingPage !== 'undefined'")
    })

    it('resolves an aliased bare export (`export { Internal as External }`) by the REAL local declared name, not the unusable external alias (#1605-sweep)', async () => {
      mockIsE2BEnabled.mockReturnValue(true)
      mockRunSequence.mockResolvedValue({
        commandResults: [
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        ],
        files: { 'output.html': REAL_HTML },
      })

      const aliased = `
function Internal() {
  return <div className="app"><h1>Hello Founder</h1></div>
}

export { Internal as FounderPage }
`
      const result = await buildInSandbox(aliased)

      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      // Pre-#1605-sweep, this resolved to the EXTERNAL alias 'FounderPage' —
      // which looked plausible as script text, but `FounderPage` is never a
      // declared identifier anywhere in this flattened, module-less script
      // (only `Internal` is), so `typeof FounderPage` always evaluates to
      // 'undefined' at runtime and the expose line was a silent no-op —
      // this component would actually render "Component not found" despite
      // the test (inspecting only script text, not executing it) passing.
      // detectRootComponent()'s priority-3 PascalCase/JSX scan finds the
      // REAL local declaration (`Internal`) instead, which genuinely works.
      expect(script).toContain(`globalThis['Internal']`)
      expect(script).toContain("typeof Internal !== 'undefined'")
    })

    it('does not treat a re-export (`export { X } from "./Y"`) as a local declaration', async () => {
      mockIsE2BEnabled.mockReturnValue(true)
      mockRunSequence.mockResolvedValue({
        commandResults: [
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        ],
        files: { 'output.html': REAL_HTML },
      })

      const reExportOnly = `
export { Something } from './other-file'

function App() {
  return <div className="app"><h1>Hello Founder</h1></div>
}
`
      const result = await buildInSandbox(reExportOnly)

      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      // Falls back to 'App' (the real local declaration), never the
      // unresolvable re-exported name from another file.
      expect(script).toContain(`globalThis['App']`)
      expect(script).not.toContain("typeof Something")
    })

    it('leaves a real `export default` component untouched (no spurious bare-export expose line)', async () => {
      mockIsE2BEnabled.mockReturnValue(true)
      mockRunSequence.mockResolvedValue({
        commandResults: [
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        ],
        files: { 'output.html': REAL_HTML },
      })

      await buildInSandbox(SIMPLE_COMPONENT)

      const script = renderScriptSentToSandbox()
      expect(script).not.toContain("typeof App !== 'undefined'")
    })
  })

  describe('arrow/class/bare-reference default exports (#1605-sweep — detectComponentName() now delegates to detectRootComponent())', () => {
    function renderScriptSentToSandbox(): string {
      const filesArg = mockRunSequence.mock.calls[0][0]
      return filesArg['render.jsx']
    }

    beforeEach(() => {
      mockIsE2BEnabled.mockReturnValue(true)
      mockRunSequence.mockResolvedValue({
        commandResults: [
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
          { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        ],
        files: { 'output.html': REAL_HTML },
      })
    })

    it('resolves an arrow-const default export referenced by a bare `export default Name;` (never matched the old `function`-only regex)', async () => {
      const code = `
const Dashboard = () => {
  return <div className="app"><h1>Hello Founder</h1></div>
}

export default Dashboard;
`
      const result = await buildInSandbox(code)
      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      // The real, correctly-identified name — not the old hardcoded 'App' guess.
      expect(script).toContain(`globalThis['Dashboard']`)
    })

    it('resolves a named class default export (the old regex only matched `function`, never `class`)', async () => {
      const code = `
class Dashboard extends React.Component {
  render() {
    return <div className="app"><h1>Hello Founder</h1></div>
  }
}

export default Dashboard;
`
      const result = await buildInSandbox(code)
      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      expect(script).toContain(`globalThis['Dashboard']`)
    })

    it('does NOT let a wrongly-guessed fallback name collide with a Lucide icon global and shadow the real component — the exact failure class this fix closes', async () => {
      // Pre-fix: detectComponentName()'s regex only understood `export
      // default function Name` and a bare `export { Name }` list. Neither
      // matched `export default Dashboard;` (a bare identifier reference to
      // an arrow-const declared above), so it fell through to the OTHER
      // bare-list export present in this file — a sibling helper aliased to
      // `Home`, which also happens to be a real lucide-react icon name
      // (bound to globalThis BEFORE "Component code" runs, see the render
      // script's own Lucide-icon-globals block). The final
      // `globalThis[compName] || globalThis.__Default__` pick would then
      // resolve to the Lucide <Home> icon glyph instead of the real
      // Dashboard component — rendering a tiny icon instead of the founder's
      // actual app, with no crash and no error to notice it by.
      const code = `
const HomeLink = () => <a href="/">Home</a>
export { HomeLink as Home }

const Dashboard = () => {
  return <div className="app"><h1>Hello Founder</h1></div>
}

export default Dashboard;
`
      const result = await buildInSandbox(code)
      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      // Must resolve to the REAL default-exported root, never the sibling
      // bare-list export that happens to share a name with a Lucide icon.
      expect(script).toContain(`globalThis['Dashboard']`)
      expect(script).not.toContain(`globalThis['Home']`)
    })

    it('resolves an anonymous arrow default export by synthesizing a bindable name (the old regex had no anonymous-export handling at all)', async () => {
      const code = `
export default () => {
  return <div className="app"><h1>Hello Founder</h1></div>
}
`
      const result = await buildInSandbox(code)
      expect(result.success).toBe(true)
      const script = renderScriptSentToSandbox()
      expect(script).toContain(`globalThis['__PreviewDefault']`)
      // The rewrite must land BEFORE buildRenderScript's own export-default
      // stripping — there must be no leftover `export default` in the
      // script's embedded component code to trip up esbuild.
      expect(script).toContain('const __PreviewDefault = ')
      expect(script).not.toContain('export default')
    })
  })
})
