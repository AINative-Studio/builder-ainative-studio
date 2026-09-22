import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#816 — duplicate-landmark gate wired into checkAppReady.
 *
 * Real bug shipped clean through the ready gate (issue #815,
 * `agentive-product`): two syntactically valid, fully-import-resolved <aside>
 * elements both render at all viewport widths — the correct desktop sidebar
 * plus a "mobile" drawer with no hide/off-canvas class, so it's permanently
 * visible instead of hidden-until-toggled. Confirmed live via direct DOM
 * query: `document.querySelectorAll('aside').length === 2`. Neither the
 * parse gate nor the completeness gate can see this class of bug — this test
 * proves checkAppReady now BLOCKS it via the same 422 retry path as every
 * other structural gate (missing_local_import, syntax_error, etc.).
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

// The exact #815 repro shape: a real desktop sidebar plus a "mobile" drawer
// with no fixed/absolute positioning and no hide/off-canvas class at all.
const DUPLICATE_SIDEBAR_APP = `
export default function App() {
  return (
    <div>
      <aside data-agent-context="sidebar" className="flex flex-col bg-[#131726] text-white transition-all duration-300 sticky top-0 h-screen w-64">
        <nav>desktop nav</nav>
      </aside>
      <aside data-agent-context="sidebar-mobile" className="translate-x-0">
        <nav>mobile nav</nav>
      </aside>
      <main data-agent-context="main-content" aria-label="App - main content">
        content
      </main>
    </div>
  )
}
`

// Correctly-built responsive drawer: the mobile aside is genuinely off-canvas
// (fixed + transform + breakpoint hide), so this must NOT be blocked.
const CORRECT_RESPONSIVE_SIDEBAR_APP = `
export default function App() {
  return (
    <div>
      <aside data-agent-context="sidebar" className="hidden md:flex md:flex-col md:w-64 md:sticky md:top-0 md:h-screen">
        <nav>desktop nav</nav>
      </aside>
      <aside data-agent-context="sidebar-mobile" className="fixed inset-y-0 left-0 z-40 w-64 transform -translate-x-full transition-transform md:hidden">
        <nav>mobile nav</nav>
      </aside>
      <main data-agent-context="main-content" aria-label="App - main content">
        content
      </main>
    </div>
  )
}
`

// A single sidebar, no duplication at all — the common, unaffected case.
const SINGLE_SIDEBAR_APP = `
export default function App() {
  return (
    <div>
      <aside data-agent-context="sidebar" className="w-64">
        <nav>nav</nav>
      </aside>
      <main data-agent-context="main-content" aria-label="App - main content">
        content
      </main>
    </div>
  )
}
`

beforeEach(() => {
  getPreview.mockReset()
  getFilesV2.mockReset()
  loadGeneration.mockReset()
  getFilesV2.mockReturnValue(null)
})

describe('builder#816 checkAppReady duplicate-landmark gate', () => {
  it('BLOCKS the agentive-product repro (duplicate sidebar, no hide class) with the retry reason', async () => {
    getPreview.mockReturnValue(DUPLICATE_SIDEBAR_APP)
    const r = await checkAppReady('chat-duplicate-sidebar')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('duplicate_landmark')
    expect(r.error).toContain('sidebar')
  })

  it('passes a CORRECTLY-BUILT responsive drawer (mobile aside genuinely off-canvas)', async () => {
    getPreview.mockReturnValue(CORRECT_RESPONSIVE_SIDEBAR_APP)
    const r = await checkAppReady('chat-correct-drawer')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('passes a SINGLE sidebar with no duplication', async () => {
    getPreview.mockReturnValue(SINGLE_SIDEBAR_APP)
    const r = await checkAppReady('chat-single-sidebar')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('BLOCKS a duplicate resolved from the DURABLE files map', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue({
      prompt: 'x',
      generatedCode: DUPLICATE_SIDEBAR_APP,
      files: { '/src/App.tsx': DUPLICATE_SIDEBAR_APP },
    })
    const r = await checkAppReady('chat-durable-duplicate')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('duplicate_landmark')
  })

  it('still FAILS OPEN on a total store miss', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue(null)
    const r = await checkAppReady('chat-missing-816')
    expect(r.checked).toBe(false)
    expect(r.ok).toBe(true)
  })
})
