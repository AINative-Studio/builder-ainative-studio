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
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  registerApp: h.registerApp,
}))
vi.mock('@/lib/build/learning', () => ({ logBuildOutcome: h.logBuildOutcome }))

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
})
