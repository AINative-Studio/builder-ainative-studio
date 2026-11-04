import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real gap, direct founder feedback (2026-11-04): company-app's ONE
 * hardcoded landing-page template ("Get early access" CTA + "pricing (3
 * tiers)") is a SaaS-waitlist shape, structurally wrong for a direct-to-
 * consumer storefront idea. Confirmed live: "build me an e-commerce store"
 * produced a generated landing page literally titled "BuildYourStore —
 * One-page e-commerce platform... Build your own e-commerce store in
 * minutes with zero coding" — the page ended up marketing Builder's OWN
 * category back at the founder instead of previewing their actual store.
 *
 * Fix: detect a genuine storefront idea via the real, already-hardened
 * selectPrimitives() idea->primitive scoring (only ZeroCommerce actually
 * composing in counts — a prior incident showed a naive keyword match on
 * this exact template caused false positives, see the 'brand'-trigger note
 * in company-app/route.ts) and use a "Shop Now" store-teaser template
 * instead of the "Get early access" SaaS-waitlist one.
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
  resolveAppVerified: async () => ({ entry: await h.resolveApp(), verified: true }),
  registerApp: h.registerApp,
}))
vi.mock('@/lib/build/learning', () => ({ logBuildOutcome: h.logBuildOutcome }))
vi.mock('@/lib/build/product-generation-state', () => ({
  recordPendingProductGeneration: h.recordPendingProductGeneration,
  markProductGenerationRegistered: h.markProductGenerationRegistered,
  resolvePendingProductGeneration: h.resolvePendingProductGeneration,
  resolvePendingProductGenerationVerified: vi.fn(async () => ({
    state: await h.resolvePendingProductGeneration(),
    verified: true,
  })),
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

function sentMessage(fetchMock: ReturnType<typeof vi.fn>): string {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  const body = JSON.parse(init.body as string)
  return body.message as string
}

describe('POST /api/build/company-app — storefront vs SaaS-waitlist landing page shape', () => {
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

  it('uses the "Shop Now" store-teaser template for a genuine e-commerce idea (the real repro)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'Build me an e-commerce store', slug: 'shoplo', name: 'Shoplo' }))
    await flush()

    const message = sentMessage(fetchMock)
    expect(message).toContain('STORE TEASER')
    expect(message).toContain('a "Shop Now" CTA')
    // The template explicitly instructs the model to AVOID the waitlist
    // phrasing (real negative instruction) — assert the CTA requirement
    // itself, not a blind substring absence.
    expect(message).not.toContain('pricing (3 tiers)')
    expect(message).not.toContain('a 3-feature section')
  })

  it('still uses the SaaS-waitlist template for a genuine non-commerce idea (no regression)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a personalized business advisor', slug: 'meridian', name: 'Meridian' }))
    await flush()

    const message = sentMessage(fetchMock)
    expect(message).toContain('Get early access')
    expect(message).toContain('pricing (3 tiers)')
    expect(message).not.toContain('STORE TEASER')
  })

  it('uses the store-teaser template even for a reinterpreted-but-still-commerce idea', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({
      idea: 'AI-curated artisan candle subscription box for millennial renters who want apartment-safe home fragrance',
      slug: 'me', name: 'Me',
    }))
    await flush()

    const message = sentMessage(fetchMock)
    expect(message).toContain('STORE TEASER')
    expect(message).toContain('Shop Now')
  })
})
