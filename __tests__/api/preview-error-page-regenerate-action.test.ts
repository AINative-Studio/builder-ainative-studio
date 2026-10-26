// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1550 — a never-generated app-track company's public preview is a real
 * dead end, not just a stuck spinner.
 *
 * Root cause confirmed live (coastal: zero rows in the `generations` table,
 * two months after creation): once the preview route's own retry budget
 * (`MAX_RETRIES = 20`, ~60s) is exhausted with no stored generation, it
 * correctly shows an honest "Preview Unavailable" page — but that page's
 * ONLY recovery button ("Try Again") posted `{ action: 'retry' }`, which
 * `StandalonePreviewRegenerate.tsx`'s message listener maps to a plain
 * `window.location.reload()`. A reload just re-runs the exact same
 * zero-generation check and lands back on the exact same page — there is no
 * path from this screen that ever calls real generation. For a company that
 * never had an initial generation triggered at all, this is a genuine,
 * permanent loop: the founder can click "Try Again" forever and nothing
 * will ever regenerate the app.
 *
 * The same mislabeled wiring existed a second place in this file: the
 * client-side "Component Not Found" fallback's "Try Regenerating" button
 * posted `{ action: 'reload' }` — same dead end, different trigger (a
 * generation that ran but produced no resolvable root component).
 *
 * Fix: both buttons now post `{ action: 'regenerate' }`, the one action the
 * listener actually wires to a real rebuild (a headless POST with
 * `force: true` for the Company track, or a redirect into the Live
 * dashboard — where Preview.tsx's own working regenerate handler lives —
 * for the App track). `'retry'`/`'reload'` remain supported by the listener
 * for any other caller, but neither of THIS file's own error pages should
 * ever emit them again.
 */

const h = vi.hoisted(() => ({
  getPreview: vi.fn(),
  getSSRPreview: vi.fn(),
  storePreview: vi.fn(),
  getChatData: vi.fn(),
  isPreviewStreaming: vi.fn(),
  loadGeneration: vi.fn(),
  resolveAppVerified: vi.fn(),
  hasFounderCredential: vi.fn(),
}))

vi.mock('@/lib/preview-store', () => ({
  getPreview: h.getPreview,
  getSSRPreview: h.getSSRPreview,
  storePreview: h.storePreview,
  getChatData: h.getChatData,
  isPreviewStreaming: h.isPreviewStreaming,
}))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: h.loadGeneration }))
vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/primitive-credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/primitive-credentials')>('@/lib/build/primitive-credentials')
  return { ...actual, hasFounderCredential: h.hasFounderCredential }
})

import { GET } from '@/app/api/preview/[id]/route'

describe('preview route error pages — the recovery button must actually regenerate (#1550)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getPreview.mockReturnValue(undefined)
    h.getSSRPreview.mockReturnValue(null)
    h.getChatData.mockReturnValue(undefined)
    h.isPreviewStreaming.mockReturnValue(false)
    h.loadGeneration.mockResolvedValue(null)
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    h.hasFounderCredential.mockResolvedValue(false)
  })

  it('"Preview Unavailable" (retries exhausted, never generated) posts a real regenerate action, not a dead-end reload', async () => {
    const req = new NextRequest('https://builder.ainative.studio/api/preview/coastal-chat-id?_r=20')
    const res = await GET(req, { params: Promise.resolve({ id: 'coastal-chat-id' }) })
    const html = await res.text()

    expect(html).toContain('Preview Unavailable')
    expect(html).toContain("action: 'regenerate'")
    // The old dead-end wiring must be gone from this page specifically.
    expect(html).not.toContain("action: 'retry'")
  })

  it('never-generated preview eventually resolves to the honest error page rather than looping past the retry budget', async () => {
    const req = new NextRequest('https://builder.ainative.studio/api/preview/coastal-chat-id?_r=20')
    const res = await GET(req, { params: Promise.resolve({ id: 'coastal-chat-id' }) })
    const html = await res.text()

    // Retries exhausted ⇒ the terminal error page, never another "Preparing…" stub.
    expect(html).not.toContain('Preparing your preview')
    expect(html).toContain('Preview Unavailable')
  })

  it('a successful render\'s embedded "Component Not Found" fallback also posts a real regenerate action', async () => {
    h.getPreview.mockReturnValue('function App() { return <div>Hello</div> }')
    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).toContain('action: &quot;regenerate&quot;')
    expect(html).not.toContain('action: &quot;reload&quot;')
  })

  /**
   * #1592 — a third dead end in this same file, found live (fluent): the
   * React ErrorBoundary that catches a RUNTIME crash in the generated app
   * (confirmed live: "TypeError: destroy is not a function", a real React
   * hook misuse in the generated code) renders a "Refining your app" card
   * whose own copy says "Try regenerating" — but, unlike the other two error
   * pages in this file, never actually rendered a button to do it. A founder
   * hitting a real runtime crash (not a generation failure, not a missing
   * component — an app that rendered then threw) had no recovery path at
   * all from this screen.
   */
  it('the React ErrorBoundary (a runtime crash in the generated app) embeds a real regenerate button, not just "try regenerating" copy (#1592)', async () => {
    h.getPreview.mockReturnValue('function App() { return <div>Hello</div> }')
    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).toContain('Refining your app')
    expect(html).toContain("type: 'ainative-preview-nav'")
    expect(html).toContain("action: 'regenerate'")
    expect(html).toContain('↻ Regenerate')
  })
})
