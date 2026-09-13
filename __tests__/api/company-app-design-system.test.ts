import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real gap (customer-reported, Meridian, 2026-09-10): the Company track's one
 * real generated app (a landing page for {slug}.ainative.studio, built via
 * this route -> chat-ws) never forwarded a chosen design system at all — the
 * Company track had no Design step to pick one from in the first place (see
 * lib/build/state.ts's PICK_TRACK), so there was nothing to forward. Meridian
 * was generated AFTER the full 40-system catalog shipped, yet its served
 * preview showed plain Inter/Poppins/#5867EF defaults — confirmed via a real
 * production request, not a stale pre-catalog record. Company track now
 * visits Design too; this route must actually forward that choice to
 * chat-ws, same as the App track already does.
 *
 * REGISTRATION NEVER HAPPENING (found live, 2026-09-13, verifying Cody
 * composes AINative primitives correctly): this route used to hold the HTTP
 * request open, synchronously consuming chat-ws's SSE stream until
 * chatId+refresh, bounded by its own 280s AbortSignal.timeout. Once the
 * cody-cli agent became the primary generation path (CODY_AGENT_PRIMARY=1),
 * a real generation routinely spends its own 240s wall-clock limit (#350) on
 * a failing agent attempt before falling back to Bedrock — pushing the real
 * end-to-end duration past 280s. Confirmed live: many real, successful
 * generations (real showcase entries) never produced a builder_app_registry
 * row — the abort fired before chatId+refresh was ever observed, so
 * registerApp() was never reached. Fixed the same way company-product/
 * route.ts's own identical bug (issue #629/#631/#633) was fixed: detached
 * background generation, 'processing' returned immediately, caller polls
 * resolve-app. Reuses lib/build/product-generation-state.ts as-is for the
 * same registration-durability guarantee across a mid-generation redeploy.
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

/** Flush the microtask queue so the detached background task's awaits settle. */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('POST /api/build/company-app', () => {
  beforeEach(() => {
    h.resolveApp.mockReset().mockResolvedValue(null)
    h.registerApp.mockReset().mockResolvedValue(true)
    h.logBuildOutcome.mockReset().mockResolvedValue(undefined)
    h.recordPendingProductGeneration.mockReset().mockResolvedValue(undefined)
    h.markProductGenerationRegistered.mockReset().mockResolvedValue(undefined)
    h.resolvePendingProductGeneration.mockReset().mockResolvedValue(null)
    h.loadGeneration.mockReset().mockResolvedValue(null)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns processing immediately without waiting for generation to finish', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'a personalized business advisor', slug: 'meridian', name: 'Meridian' }))
    const data = await res.json()

    expect(data.status).toBe('processing')
    expect(data.chatId).toBeUndefined()
  })

  it('registers the app once the detached background task resolves', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a personalized business advisor', slug: 'meridian', name: 'Meridian' }))
    await flush()

    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'meridian', chatId: 'abc123' }))
  })

  it('passes a real designSystemId straight through to the chat-ws request body', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({
      idea: 'a personalized business advisor', slug: 'meridian', name: 'Meridian',
      tagline: 'Your business, clearly charted.', color: '#2D6BE4', designSystemId: 'ledger',
    }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBe('ledger')
  })

  it('forwards undefined (not a fabricated default) when no designSystemId was given', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({
      idea: 'a personalized business advisor', slug: 'meridian2', name: 'Meridian',
      tagline: '', color: '#2D6BE4',
    }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBeUndefined()
  })

  it('ignores a non-string designSystemId rather than forwarding garbage', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({
      idea: 'a personalized business advisor', slug: 'meridian3', name: 'Meridian',
      color: '#2D6BE4', designSystemId: 12345,
    }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBeUndefined()
  })

  it('sets landingPageOnly — this route only ever builds marketing copy', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a personalized business advisor', slug: 'meridian-landing', name: 'Meridian' }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.landingPageOnly).toBe(true)
  })

  it('returns the cached chatId without calling chat-ws again when the slug already resolves', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'already-built' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian', designSystemId: 'ledger' }))
    const data = await res.json()

    expect(data.chatId).toBe('already-built')
    expect(data.cached).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires idea and slug', async () => {
    const res = await POST(req({ name: 'Meridian' }))
    expect(res.status).toBe(400)
  })

  it('logs a failure outcome (does not throw) when the background generation fetch fails', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network down') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian9', name: 'Meridian' }))
    const data = await res.json()
    await flush()

    expect(data.status).toBe('processing')
    expect(h.logBuildOutcome).toHaveBeenCalledWith(expect.objectContaining({ slug: 'meridian9', codeStatus: 'failure' }))
    expect(h.registerApp).not.toHaveBeenCalled()
  })

  /**
   * Registration durability (same fix as company-product/route.ts's #660
   * follow-up): chat-ws's own saveGeneration() is awaited before it emits
   * 'complete', so a chatId's generated code is durably persisted the moment
   * 'init' is seen — well before this route's background task would go on
   * to call registerApp() after observing 'complete'. A Railway redeploy
   * kills that background task's container anywhere in between, orphaning a
   * genuinely successful generation.
   */
  describe('registration-durability recovery', () => {
    it('records a pending {slug -> chatId} link as soon as chatId is known, before waiting for complete', async () => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('chat-10') }) as any)
      vi.stubGlobal('fetch', fetchMock)

      await POST(req({ idea: 'x', slug: 'orphan1', name: 'Orphan' }))
      await flush()

      expect(h.recordPendingProductGeneration).toHaveBeenCalledWith('orphan1', 'chat-10')
    })

    it('recovers an orphaned generation: finds a pending chatId whose code already persisted, registers it WITHOUT starting a new generation', async () => {
      h.resolvePendingProductGeneration.mockResolvedValue({
        productSlug: 'orphan2', chatId: 'orphaned-chat-1', status: 'pending', createdAt: new Date().toISOString(),
      })
      h.loadGeneration.mockResolvedValue({ generatedCode: '// --- FILE: src/App.tsx ---\nreal code here', prompt: 'x' })
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(req({ idea: 'x', slug: 'orphan2', name: 'Orphan' }))
      const data = await res.json()

      expect(data.status).toBe('recovered')
      expect(data.chatId).toBe('orphaned-chat-1')
      expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'orphan2', chatId: 'orphaned-chat-1' }))
      expect(h.markProductGenerationRegistered).toHaveBeenCalledWith('orphan2', 'orphaned-chat-1')
      // The costly part (a fresh chat-ws generation) must NOT be re-run —
      // the whole point is not wasting an already-succeeded generation.
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('a pending attempt that is still genuinely fresh (well within the generation window) with no persisted code yet returns processing, without starting a duplicate generation', async () => {
      h.resolvePendingProductGeneration.mockResolvedValue({
        productSlug: 'orphan3', chatId: 'still-running-chat', status: 'pending', createdAt: new Date().toISOString(),
      })
      h.loadGeneration.mockResolvedValue(null)
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(req({ idea: 'x', slug: 'orphan3', name: 'Orphan' }))
      const data = await res.json()

      expect(data.status).toBe('processing')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(h.registerApp).not.toHaveBeenCalled()
    })

    it('a pending attempt old enough to be genuinely dead (past the generation window) with no persisted code falls through to a fresh generation', async () => {
      const longAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString() // 20 minutes ago
      h.resolvePendingProductGeneration.mockResolvedValue({
        productSlug: 'orphan4', chatId: 'truly-dead-chat', status: 'pending', createdAt: longAgo,
      })
      h.loadGeneration.mockResolvedValue(null)
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('fresh-retry-chat') }) as any)
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(req({ idea: 'x', slug: 'orphan4', name: 'Orphan' }))
      const data = await res.json()
      await flush()

      expect(data.status).toBe('processing')
      expect(fetchMock).toHaveBeenCalled()
      expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'orphan4', chatId: 'fresh-retry-chat' }))
    })
  })
})
