import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real gap (customer-reported, Meridian, 2026-09-10, issue #620): the ONE
 * real app a Company-track build got was always /api/build/company-app's
 * marketing landing page — never the founder's ACTUAL product. Meridian's
 * idea is "a personalized business advisor that analyzes... sales pipeline
 * data... to forecast revenue," but its landing page contained zero code
 * that called ZeroPipeline or did any forecasting.
 *
 * /api/build/company-product builds that missing product via the SAME real
 * codegen engine (/api/chat-ws) the App track uses, WITHOUT landingPageOnly
 * (unlike company-app), so primitive compliance stays fully enforced —
 * and registers it under a slug distinct from the landing page's own, so
 * the two never collide.
 *
 * Real bug found live (issue #629/#631/#633, 2026-09-10): this route used to
 * hold the HTTP request open, synchronously consuming chat-ws's SSE stream
 * until 'complete' before responding — but Railway's edge proxy sits in
 * FRONT of this container with its own hard request timeout around 300s
 * that no server-side maxDuration/AbortSignal tuning can control. A real
 * generation that needs the primitive-compliance retry (#624-#627) can
 * legitimately run past that, and a genuinely successful generation still
 * came back as a 502 at the 300s mark. The route now kicks off generation
 * as a DETACHED background task and returns { status: 'processing' }
 * immediately; the caller polls /api/build/resolve-app instead.
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

import { POST } from '@/app/api/build/company-product/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/company-product' } as any
}

function sseBody(chatId: string) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'init', chatId })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'files', files: {} })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', chatId })}\n\n`))
      controller.close()
    },
  })
}

/** Flush the microtask queue so the detached background task's awaits settle. */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('POST /api/build/company-product', () => {
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
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-1') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian', name: 'Meridian' }))
    const data = await res.json()

    expect(data.status).toBe('processing')
    expect(data.productSlug).toBe('meridian-product')
    expect(data.chatId).toBeUndefined()
  })

  it('registers the product (under a slug DISTINCT from the landing page slug) once the detached background task resolves', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-1') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian', name: 'Meridian' }))
    await flush()

    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'meridian-product', chatId: 'prod-chat-1' }))
  })

  it('does NOT set landingPageOnly — primitive compliance stays fully enforced', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-2') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian2', name: 'Meridian' }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.landingPageOnly).toBeUndefined()
  })

  it('the prompt asks for a real, working product — not a landing page', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-3') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian3', name: 'Meridian' }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.message).toMatch(/real, working, functional application/i)
    expect(sentBody.message).not.toMatch(/marketing LANDING PAGE/i)
  })

  it('forwards designSystemId when chosen', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-4') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'x', slug: 'meridian4', name: 'Meridian', designSystemId: 'cloud' }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBe('cloud')
  })

  it('returns the cached chatId synchronously, without calling chat-ws again, when the product slug already resolves', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'already-built' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian5', name: 'Meridian' }))
    const data = await res.json()

    expect(data.chatId).toBe('already-built')
    expect(data.status).toBe('cached')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires idea and slug', async () => {
    const res = await POST(req({ name: 'Meridian' }))
    expect(res.status).toBe(400)
  })

  /**
   * Real bug found live (Meridian, 2026-09-10): the FIRST draft of this
   * route's prompt said "the ACTUAL PRODUCT" — the whole word 'product' —
   * which lib/prd-parser.ts's keyword detector (correctly, per #615's fix)
   * still caught, because this time 'product' was genuinely, literally
   * present as a standalone word, not a substring-of-another-word false
   * positive. Confirmed live: this produced a real "Products Page
   * (/products)" build step and a 2-page complexity score for what should
   * be a plain single-surface generation. Reworded to avoid the word
   * 'product' (and 'match'/'matching', the two-sided-marketplace
   * primitive's own trigger) entirely.
   */
  it("does not use the word 'product' anywhere in the generated prompt (self-inflicted false-trigger guard)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-6') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian6', name: 'Meridian' }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.message.toLowerCase()).not.toMatch(/\bproduct\b/)
  })

  it("does not use the word 'match'/'matching' anywhere (would false-trigger the marketplace primitive)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-7') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian7', name: 'Meridian' }))
    await flush()

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.message.toLowerCase()).not.toMatch(/\bmatch(ing)?\b/)
  })

  /**
   * Real bug found live (Meridian, 2026-09-10, issue #629): breaking on the
   * FIRST 'refresh'/'files' event registered the app against an early,
   * unrepaired draft — before chat-ws's obedience-repair / closePrimitive-
   * ComplianceGap retry, and before its final ZeroDB persist, both of which
   * run right before the ONE 'complete' event. Multiple intermediate
   * refresh/files events (mid-generation streaming chunks) must NOT trigger
   * registration — only 'complete' may.
   */
  it('waits for the complete event, not just the first refresh/files event, before registering the app', async () => {
    const encoder = new TextEncoder()
    let registeredAt: 'too-early' | 'after-complete' | null = null
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'init', chatId: 'prod-chat-8' })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'files', files: { '/App.tsx': 'partial' } })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', chatId: 'prod-chat-8' })}\n\n`))
        controller.close()
      },
    })
    h.registerApp.mockImplementation(async () => {
      registeredAt = 'after-complete'
      return true
    })
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body }) as any)
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian8', name: 'Meridian' }))
    const data = await res.json()
    await flush()

    expect(data.status).toBe('processing')
    expect(registeredAt).toBe('after-complete')
  })

  /**
   * Real bug found live (issue #629/#631/#633, 2026-09-10): the OLD
   * synchronous version returned a 502 to the caller when chat-ws's fetch
   * failed/timed out, even when nothing else could be done about it. Now
   * that generation is detached, a background failure must never surface as
   * an HTTP error — the initial response has already been sent. It should
   * just be logged (logBuildOutcome 'failure') so the caller's poll loop
   * eventually gives up on its own, not so the (already-sent) response
   * fails.
   */
  it('logs a failure outcome (does not throw) when the background generation fetch fails', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network down') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian9', name: 'Meridian' }))
    const data = await res.json()
    await flush()

    expect(data.status).toBe('processing')
    expect(h.logBuildOutcome).toHaveBeenCalledWith(expect.objectContaining({ slug: 'meridian9-product', codeStatus: 'failure' }))
    expect(h.registerApp).not.toHaveBeenCalled()
  })

  /**
   * Registration durability (issue #660 follow-up, found live): chat-ws's own
   * saveGeneration() is awaited before it emits 'complete', so a chatId's
   * generated code is durably persisted in `generations` the moment 'init'
   * is seen — well before this route's background task would go on to call
   * registerApp() after observing 'complete'. A Railway redeploy kills that
   * background task's container anywhere in between, orphaning a genuinely
   * successful generation: real code sitting in `generations`, never linked
   * to productSlug. Confirmed live against a real Dispatch product
   * generation (chat_id WpyFu_-dMZ6s8SVdMfSxR): correct, primitive-wired
   * code, safely persisted, but registerApp never ran.
   */
  describe('registration-durability recovery', () => {
    it('records a pending {productSlug -> chatId} link as soon as chatId is known, before waiting for complete', async () => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-10') }) as any)
      vi.stubGlobal('fetch', fetchMock)

      await POST(req({ idea: 'x', slug: 'orphan1', name: 'Orphan' }))
      await flush()

      expect(h.recordPendingProductGeneration).toHaveBeenCalledWith('orphan1-product', 'prod-chat-10')
    })

    it('recovers an orphaned generation: finds a pending chatId whose code already persisted, registers it WITHOUT starting a new generation', async () => {
      h.resolvePendingProductGeneration.mockResolvedValue({
        productSlug: 'orphan2-product', chatId: 'orphaned-chat-1', status: 'pending', createdAt: new Date().toISOString(),
      })
      h.loadGeneration.mockResolvedValue({ generatedCode: '// --- FILE: src/App.tsx ---\nreal code here', prompt: 'x' })
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(req({ idea: 'x', slug: 'orphan2', name: 'Orphan' }))
      const data = await res.json()

      expect(data.status).toBe('recovered')
      expect(data.chatId).toBe('orphaned-chat-1')
      expect(data.productSlug).toBe('orphan2-product')
      expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'orphan2-product', chatId: 'orphaned-chat-1' }))
      expect(h.markProductGenerationRegistered).toHaveBeenCalledWith('orphan2-product', 'orphaned-chat-1')
      // The costly part (a fresh chat-ws generation) must NOT be re-run —
      // the whole point is not wasting an already-succeeded generation.
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('a pending attempt that is still genuinely fresh (well within the generation window) with no persisted code yet returns processing, without starting a duplicate generation', async () => {
      h.resolvePendingProductGeneration.mockResolvedValue({
        productSlug: 'orphan3-product', chatId: 'still-running-chat', status: 'pending', createdAt: new Date().toISOString(),
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
        productSlug: 'orphan4-product', chatId: 'truly-dead-chat', status: 'pending', createdAt: longAgo,
      })
      h.loadGeneration.mockResolvedValue(null)
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('fresh-retry-chat') }) as any)
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(req({ idea: 'x', slug: 'orphan4', name: 'Orphan' }))
      const data = await res.json()
      await flush()

      expect(data.status).toBe('processing')
      expect(fetchMock).toHaveBeenCalled()
      expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'orphan4-product', chatId: 'fresh-retry-chat' }))
    })

    it('a pending record already marked registered is ignored by the recovery check (resolveApp\'s own cache already covers it)', async () => {
      h.resolvePendingProductGeneration.mockResolvedValue({
        productSlug: 'orphan5-product', chatId: 'already-done-chat', status: 'registered', createdAt: new Date().toISOString(),
      })
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('should-not-matter') }) as any)
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(req({ idea: 'x', slug: 'orphan5', name: 'Orphan' }))
      const data = await res.json()

      // resolveApp (the existing cache check) returned null in this test, so
      // a 'registered' pending record with no matching app-registry entry is
      // an inconsistent state this route doesn't try to special-case — it
      // just proceeds normally (starts a fresh generation), same as if no
      // pending record existed at all.
      expect(data.status).toBe('processing')
      expect(fetchMock).toHaveBeenCalled()
    })
  })
})
