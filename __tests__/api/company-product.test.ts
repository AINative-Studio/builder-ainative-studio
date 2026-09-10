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
      controller.close()
    },
  })
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

  it('registers the product under a slug DISTINCT from the landing page slug', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-1') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian', name: 'Meridian' }))
    const data = await res.json()

    expect(data.productSlug).toBe('meridian-product')
    expect(data.chatId).toBe('prod-chat-1')
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'meridian-product', chatId: 'prod-chat-1' }))
  })

  it('does NOT set landingPageOnly — primitive compliance stays fully enforced', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-2') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian2', name: 'Meridian' }))

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.landingPageOnly).toBeUndefined()
  })

  it('the prompt asks for a real, working product — not a landing page', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-3') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian3', name: 'Meridian' }))

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.message).toMatch(/real, working, functional application/i)
    expect(sentBody.message).not.toMatch(/marketing LANDING PAGE/i)
  })

  it('forwards designSystemId when chosen', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-4') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'x', slug: 'meridian4', name: 'Meridian', designSystemId: 'cloud' }))

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBe('cloud')
  })

  it('returns the cached chatId without calling chat-ws again when the product slug already resolves', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'already-built' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian5', name: 'Meridian' }))
    const data = await res.json()

    expect(data.chatId).toBe('already-built')
    expect(data.cached).toBe(true)
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

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.message.toLowerCase()).not.toMatch(/\bproduct\b/)
  })

  it("does not use the word 'match'/'matching' anywhere (would false-trigger the marketplace primitive)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('prod-chat-7') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a sales pipeline revenue forecaster', slug: 'meridian7', name: 'Meridian' }))

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.message.toLowerCase()).not.toMatch(/\bmatch(ing)?\b/)
  })
})
