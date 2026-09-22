import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real gap found live (2026-09-21): a standalone /build/{slug} page (opened
 * via a shared link, or "Open your product" in a new tab) has no chat/
 * reducer context, so when the served generation's code failed server-side
 * validation, the honest "This build needs another pass" error page's real
 * "Regenerate this app" button had nowhere to force a fresh attempt — this
 * route's own cache check (`if (existing?.chatId) return { cached: true }`)
 * always short-circuited back to the SAME broken chatId forever, since it
 * only checks whether the slug resolves at all, never whether that
 * resolution is actually good code. `force: true` bypasses the cache.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(async (): Promise<{ chatId: string } | null> => null),
  registerApp: vi.fn(async () => true),
  logBuildOutcome: vi.fn(async () => {}),
  recordPendingProductGeneration: vi.fn(async () => {}),
  markProductGenerationRegistered: vi.fn(async () => {}),
  resolvePendingProductGeneration: vi.fn(async (): Promise<{ productSlug: string; chatId: string; status: 'pending' | 'registered'; createdAt: string } | null> => null),
  loadGeneration: vi.fn(async (): Promise<{ generatedCode: string; prompt: string } | null> => null),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  registerApp: h.registerApp,
}))
vi.mock('@/lib/build/learning', () => ({ logBuildOutcome: h.logBuildOutcome }))
vi.mock('@/lib/build/product-generation-state', () => ({
  recordPendingProductGeneration: h.recordPendingProductGeneration,
  markProductGenerationRegistered: h.markProductGenerationRegistered,
  resolvePendingProductGeneration: h.resolvePendingProductGeneration,
}))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: h.loadGeneration }))

import { POST } from '@/app/api/build/company-app/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/company-app' } as any
}

function sseBody(chatId: string) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'init', chatId })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', chatId })}\n\n`))
      controller.close()
    },
  })
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('POST /api/build/company-app — force regenerate (2026-09-21)', () => {
  beforeEach(() => {
    h.resolveApp.mockReset()
    h.registerApp.mockReset().mockResolvedValue(true)
    h.logBuildOutcome.mockReset().mockResolvedValue(undefined)
    h.recordPendingProductGeneration.mockReset().mockResolvedValue(undefined)
    h.markProductGenerationRegistered.mockReset().mockResolvedValue(undefined)
    h.resolvePendingProductGeneration.mockReset().mockResolvedValue(null)
    h.loadGeneration.mockReset().mockResolvedValue(null)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('force:true bypasses the cache and starts a fresh generation even though the slug already resolves', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'broken-chat-id' })
    const fetchMock = vi.fn(async () => new Response(sseBody('fresh-chat-id'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian-force1', name: 'Meridian', force: true }))
    await flush()
    const data = await res.json()

    expect(data.cached).not.toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('without force, the same already-resolving slug still returns cached and never calls chat-ws (unchanged default behavior)', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'broken-chat-id' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian-force2', name: 'Meridian' }))
    const data = await res.json()

    expect(data.cached).toBe(true)
    expect(data.chatId).toBe('broken-chat-id')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
