// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Same bug class as #2004/#2008: the preview route's "extract from markdown
 * code blocks" step (STEP 1, used when the stored content isn't multi-file)
 * used a lazy, unanchored /```lang?\n([\s\S]*?)```/ regex that matched the
 * FIRST "```" found anywhere as the close — including a decoy ``` pair
 * inside the real component's own JSDoc @example block — discarding the
 * real component declaration that followed it, which would render as a
 * blank/broken preview.
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

describe('preview route — markdown-fenced content with a nested decoy fence is not truncated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getSSRPreview.mockReturnValue(null)
    h.getChatData.mockReturnValue(undefined)
    h.isPreviewStreaming.mockReturnValue(false)
    h.loadGeneration.mockResolvedValue(null)
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    h.hasFounderCredential.mockResolvedValue(false)
  })

  it('a JSDoc @example fenced snippet inside the stored markdown block does not truncate the real component', async () => {
    const stored = [
      '```tsx',
      '/**',
      ' * @example',
      ' * ```jsx',
      ' * <InstallCommand pkg="my-sdk" />',
      ' * ```',
      ' */',
      'function App() {',
      '  return <div>RealComponentMarker</div>',
      '}',
      '```',
    ].join('\n')
    h.getPreview.mockReturnValue(stored)

    const req = new NextRequest('https://builder.ainative.studio/api/preview/some-chat-id')
    const res = await GET(req, { params: Promise.resolve({ id: 'some-chat-id' }) })
    const html = await res.text()

    expect(html).toContain('RealComponentMarker')
  })
})
