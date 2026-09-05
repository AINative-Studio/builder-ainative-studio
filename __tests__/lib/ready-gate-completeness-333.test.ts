import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#333 — completeness gate wired into checkAppReady.
 *
 * A truncated multi-file generation (App imports Analytics, the stream was cut
 * before Analytics was emitted) passes the per-file parse gate but must NOT be
 * marked ready: register-app returns its 422 retry path and the client
 * regenerates instead of persisting a broken app.
 */

const getPreview = vi.fn<(id: string) => string | undefined>()
const getFilesV2 = vi.fn<(id: string) => Record<string, string> | null>()
const loadGeneration = vi.fn<
  (id: string) => Promise<{
    prompt: string
    generatedCode: string
    ssrHtml?: string
    files?: Record<string, string> | null
  } | null>
>()

vi.mock('@/lib/preview-store', () => ({ getPreview: (id: string) => getPreview(id) }))
vi.mock('@/lib/preview-store-v2', () => ({ getFiles: (id: string) => getFilesV2(id) }))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: (id: string) => loadGeneration(id) }))

import { checkAppReady } from '@/lib/build/ready-gate'

const COMPLETE_BLOB = [
  `// --- FILE: src/App.tsx ---`,
  `import Sidebar from './components/Sidebar'`,
  `export default function App(){ const [n, setN] = useState(0); return <div><Sidebar/><button onClick={() => setN(n + 1)}>{n}</button></div> }`,
  `// --- FILE: src/components/Sidebar.tsx ---`,
  `export default function Sidebar(){ return <aside>nav</aside> }`,
].join('\n')

const TRUNCATED_BLOB = [
  `// --- FILE: src/App.tsx ---`,
  `import Sidebar from './components/Sidebar'`,
  `import Analytics from './components/Analytics'`,
  `export default function App(){ return <div><Sidebar/><Analytics/></div> }`,
  `// --- FILE: src/components/Sidebar.tsx ---`,
  `export default function Sidebar(){ return <aside>nav</aside> }`,
].join('\n')

beforeEach(() => {
  getPreview.mockReset()
  getFilesV2.mockReset()
  loadGeneration.mockReset()
  getFilesV2.mockReturnValue(null)
})

describe('builder#333 checkAppReady completeness gate', () => {
  it('passes a COMPLETE multi-file blob', async () => {
    getPreview.mockReturnValue(COMPLETE_BLOB)
    const r = await checkAppReady('chat-complete')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('BLOCKS a truncated blob (Analytics imported, never defined) with the retry reason', async () => {
    getPreview.mockReturnValue(TRUNCATED_BLOB)
    const r = await checkAppReady('chat-truncated')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_local_import')
    expect(r.error).toContain('./components/Analytics')
  })

  it('BLOCKS a truncated app resolved from the DURABLE files map', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue({
      prompt: 'x',
      generatedCode: `import Analytics from './components/Analytics'\nexport default function App(){ return <Analytics/> }`,
      files: {
        '/src/App.tsx': `import Analytics from './components/Analytics'\nexport default function App(){ return <Analytics/> }`,
      },
    })
    const r = await checkAppReady('chat-durable-truncated')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_local_import')
  })

  it('passes a durable multi-file app whose files map is complete', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue({
      prompt: 'x',
      generatedCode: COMPLETE_BLOB,
      files: {
        '/src/App.tsx': `import Sidebar from './components/Sidebar'\nexport default function App(){ return <div><Sidebar/></div> }`,
        '/src/components/Sidebar.tsx': `export default function Sidebar(){ return <aside>nav</aside> }`,
      },
    })
    const r = await checkAppReady('chat-durable-complete')
    expect(r.ok).toBe(true)
  })

  it('uses the in-memory V2 files map when the preview store has the blob', async () => {
    getPreview.mockReturnValue(
      `import Widget from './components/Widget'\nexport default function App(){ return <Widget/> }`,
    )
    getFilesV2.mockReturnValue({
      '/src/App.tsx': `import Widget from './components/Widget'\nexport default function App(){ return <Widget/> }`,
      '/src/components/Widget.tsx': `export default function Widget(){ return <div>w</div> }`,
    })
    const r = await checkAppReady('chat-mem-files')
    expect(r.ok).toBe(true)
  })

  it('still FAILS OPEN on a total store miss', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue(null)
    const r = await checkAppReady('chat-missing')
    expect(r.checked).toBe(false)
    expect(r.ok).toBe(true)
  })

  // builder#499: register-app rejected genuinely valid, successfully-generated
  // apps with a 422 generation_failed/syntax_error at the FLATTENED-PARSE gate.
  // Root cause: app/api/chat-ws/route.ts's storePreview() call wraps the served
  // code in a markdown fence (`` `\`\`\`jsx\n${finalContent}\n\`\`\`` ``) before
  // writing it to the SAME in-memory preview store checkAppReady reads via
  // getPreview() FIRST — so the real stored.code is routinely fenced, not the
  // bare FILE-marker blob a manual reconstruction would produce. The stray
  // closing ``` landed inside the last file's body and broke the flattened
  // parse (an "Unterminated template" — matching the issue's exact
  // "flattened-parse error at a specific location" symptom) even though the
  // per-file completeness/import checks above it all passed cleanly.
  it('passes a COMPLETE multi-file blob wrapped in a markdown code fence (the real in-memory preview-store shape, builder#499)', async () => {
    getPreview.mockReturnValue('```jsx\n' + COMPLETE_BLOB + '\n```')
    const r = await checkAppReady('chat-fenced-complete')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(true)
  })
})
