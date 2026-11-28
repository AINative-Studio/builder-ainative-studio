// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #2243 — confirmed live on `a-b2b-sales-crm-for-roofing-contractors-f4k20l`
 * (chatId f4k20l6jcFZLBuIf8HpKT): its durable `files` map has a truncated
 * `MemorySearch.tsx`, which `buildSandpackFiles()` already self-heals
 * (stubTruncatedFiles) before the real Sandpack render — `shouldUseSandpack`
 * is true for this company, so `/build/{slug}` renders fine. But this route
 * (the exact fallback StandalonePreviewFrame/ShowcaseThumbnail/the
 * standalone /preview/[id] page all use on a Sandpack-timeout or when
 * shouldUseSandpack is false) fed the RAW map straight into
 * flattenParsedFiles()/validateJavaScriptCode(), which fails on the
 * truncated file — a fabricated "needs another pass" error page for an app
 * that isn't actually broken. Same self-heal (stubTruncatedFiles /
 * stubMissingLocalComponents) now runs on this path too.
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

describe('preview route — self-heals a truncated/missing-import durable files map before validating (#2243)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The route only reaches the durable-files-map logic once `content`
    // (getPreview()) is truthy — same placeholder every other durable-files
    // test (#1994/#2153) uses; the files map, not this blob, is what each
    // test below actually exercises.
    h.getPreview.mockReturnValue([
      '// --- FILE: /src/App.tsx ---',
      'export default function App() { return <div>UnusedGeneratedCodeMarker</div> }',
    ].join('\n'))
    h.getSSRPreview.mockReturnValue(null)
    h.getChatData.mockReturnValue(undefined)
    h.isPreviewStreaming.mockReturnValue(false)
    h.loadGeneration.mockResolvedValue(null)
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    h.hasFounderCredential.mockResolvedValue(false)
  })

  it('renders cleanly when the durable files map has a truncated child file Sandpack would stub', async () => {
    const files = {
      '/src/App.tsx': [
        "import Dashboard from './components/Dashboard'",
        "import MemorySearch from './components/MemorySearch'",
        'export default function App() {',
        '  return <div><Dashboard /><MemorySearch /><span>RealAppMarker</span></div>',
        '}',
      ].join('\n'),
      '/src/components/Dashboard.tsx': [
        'export default function Dashboard() {',
        '  return <div>DashboardMarker</div>',
        '}',
      ].join('\n'),
      // Truncated mid-statement, exactly like the live MemorySearch.tsx repro — no export, cuts off.
      '/src/components/MemorySearch.tsx': [
        "import React, { useState } from 'react'",
        'export default function MemorySearch() {',
        '  const [query, setQuery] = useState(',
      ].join('\n'),
    }
    h.getFilesV2.mockReturnValue(files)

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).not.toContain('This build needs another pass')
    expect(html).not.toContain('id="regen"')
    expect(html).toContain('RealAppMarker')
  })

  it('renders cleanly when the durable files map imports a child file that was never generated', async () => {
    const files = {
      '/src/App.tsx': [
        "import Dashboard from './components/Dashboard'",
        "import Missing from './components/Missing'",
        'export default function App() {',
        '  return <div><Dashboard /><Missing /><span>MissingImportMarker</span></div>',
        '}',
      ].join('\n'),
      '/src/components/Dashboard.tsx': [
        'export default function Dashboard() {',
        '  return <div>DashboardMarker</div>',
        '}',
      ].join('\n'),
    }
    h.getFilesV2.mockReturnValue(files)

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).not.toContain('This build needs another pass')
    expect(html).not.toContain('id="regen"')
    expect(html).toContain('MissingImportMarker')
  })

  it('never mutates the shared getFilesV2() cache entry it heals', async () => {
    const files = {
      '/src/App.tsx': [
        "import MemorySearch from './components/MemorySearch'",
        'export default function App() {',
        '  return <div><MemorySearch /><span>NoMutationMarker</span></div>',
        '}',
      ].join('\n'),
      '/src/components/MemorySearch.tsx': [
        "import React, { useState } from 'react'",
        'export default function MemorySearch() {',
        '  const [query, setQuery] = useState(',
      ].join('\n'),
    }
    h.getFilesV2.mockReturnValue(files)
    const originalMemorySearch = files['/src/components/MemorySearch.tsx']

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })

    expect(files['/src/components/MemorySearch.tsx']).toBe(originalMemorySearch)
  })
})
