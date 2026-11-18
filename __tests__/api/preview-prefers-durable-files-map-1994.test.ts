// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1994/#2153 — the structured `files` map (the Sandpack path's and
 * /api/generation/{id}/files's source of truth) can hold a correct
 * generation while the SEPARATE `generatedCode` text blob this route used
 * to rely on exclusively has drifted stale/corrupt. Confirmed live twice,
 * two different corruption shapes:
 *   - #1994: tidemark/driftwood — `generatedCode` held a truncated
 *     `AIKitHeader.tsx` producing `const AIKitHeader = ;` (a SyntaxError),
 *     while `files` held the correct component. #1995 only guarded the one
 *     narrow corruption shape (an empty default-export fallback), not the
 *     underlying drift itself.
 *   - #2153: shoplo-OYP2Bz — reconstructing from `files` parses clean, but
 *     the live `/api/preview/{chatId}` hard-failed with "Unexpected token"
 *     pointing at `public/robots.txt`'s own plain-text content, meaning
 *     whatever `generatedCode` currently holds for this generation differs
 *     from the structured map in a way that leaks non-JS content into the
 *     parsed componentCode.
 *
 * Fix: prefer the durable `files` map (fetched up front, same two-tier
 * lookup /api/generation/{id}/files itself uses) over re-deriving file
 * boundaries from the `generatedCode` text blob, whenever it has more than
 * one entry.
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
  getFilesV2: vi.fn(),
}))

vi.mock('@/lib/preview-store', () => ({
  getPreview: h.getPreview,
  getSSRPreview: h.getSSRPreview,
  storePreview: h.storePreview,
  getChatData: h.getChatData,
  isPreviewStreaming: h.isPreviewStreaming,
}))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: h.loadGeneration }))
vi.mock('@/lib/preview-store-v2', () => ({ getFiles: h.getFilesV2 }))
vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/primitive-credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/primitive-credentials')>('@/lib/build/primitive-credentials')
  return { ...actual, hasFounderCredential: h.hasFounderCredential }
})

import { GET } from '@/app/api/preview/[id]/route'

describe('preview route — prefers the durable files map over a drifted generatedCode blob (#1994/#2153)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getSSRPreview.mockReturnValue(null)
    h.getChatData.mockReturnValue(undefined)
    h.isPreviewStreaming.mockReturnValue(false)
    h.loadGeneration.mockResolvedValue(null)
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    h.hasFounderCredential.mockResolvedValue(false)
    h.getFilesV2.mockReturnValue(null)
  })

  it('renders from the clean durable files map even when the generatedCode blob is corrupt (e.g. a public-asset leak)', async () => {
    // generatedCode: a corrupted multi-file blob whose App.tsx got merged with
    // plain-text, non-JS public-asset content (the #2153 shoplo shape).
    const corruptContent = [
      '// --- FILE: /src/App.tsx ---',
      'export default function App() {',
      '  return <div>CorruptMarker',
      '# AINative Robots.txt — not valid JS here',
      '  </div>',
      '}',
    ].join('\n')
    h.getPreview.mockReturnValue(corruptContent)

    // files: the clean, structured map — what Sandpack and
    // /api/generation/{id}/files already agree is correct.
    h.getFilesV2.mockReturnValue({
      '/src/App.tsx': [
        "import Hero from './components/Hero'",
        'export default function App() {',
        '  return <Hero />',
        '}',
      ].join('\n'),
      '/src/components/Hero.tsx': [
        'export default function Hero() {',
        '  return <div>CleanDurableMarker</div>',
        '}',
      ].join('\n'),
    })

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).toContain('CleanDurableMarker')
    expect(html).not.toContain('CorruptMarker')
    expect(html).not.toContain('AINative Robots.txt')
  })

  it('falls back to the generatedCode blob when no durable files map is available (no regression)', async () => {
    const content = [
      '// --- FILE: /src/App.tsx ---',
      'export default function App() {',
      '  return <div>OnlyContentMarker</div>',
      '}',
    ].join('\n')
    h.getPreview.mockReturnValue(content)
    h.getFilesV2.mockReturnValue(null)

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).toContain('OnlyContentMarker')
  })

  it('falls back to the generatedCode blob when the durable files map has only one entry (nothing structural to prefer)', async () => {
    const content = [
      '// --- FILE: /src/App.tsx ---',
      'export default function App() {',
      '  return <div>SingleEntryFallbackMarker</div>',
      '}',
    ].join('\n')
    h.getPreview.mockReturnValue(content)
    h.getFilesV2.mockReturnValue({ '/src/App.tsx': 'export default function App() { return <div>Unused</div> }' })

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).toContain('SingleEntryFallbackMarker')
  })

  it('a getFilesV2 throw never breaks the preview — degrades to the generatedCode blob', async () => {
    const content = [
      '// --- FILE: /src/App.tsx ---',
      'export default function App() {',
      '  return <div>DegradesSafelyMarker</div>',
      '}',
    ].join('\n')
    h.getPreview.mockReturnValue(content)
    h.getFilesV2.mockImplementation(() => { throw new Error('store down') })

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('DegradesSafelyMarker')
  })
})
