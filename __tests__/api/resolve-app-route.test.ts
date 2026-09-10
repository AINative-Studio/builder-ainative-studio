import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET /api/build/resolve-app — polling counterpart to company-product's
 * decoupled generation (issue #629/#631/#633, 2026-09-10). company-product
 * now returns { status: 'processing' } immediately and runs the real
 * generation as a detached background task (Railway's edge proxy has its
 * own hard request timeout around 300s that a real generation + primitive-
 * compliance repair round-trip can legitimately exceed — confirmed live).
 * The client polls this endpoint until registerApp lands.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(async (): Promise<{ chatId: string } | null> => null),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))

import { GET } from '@/app/api/build/resolve-app/route'

function req(url: string) {
  return { url } as any
}

describe('GET /api/build/resolve-app', () => {
  beforeEach(() => { h.resolveApp.mockReset().mockResolvedValue(null) })
  afterEach(() => { vi.restoreAllMocks() })

  it('requires a slug', async () => {
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app'))
    expect(res.status).toBe(400)
  })

  it('returns chatId: null when the slug has not resolved yet', async () => {
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=meridian-product'))
    const data = await res.json()
    expect(data.slug).toBe('meridian-product')
    expect(data.chatId).toBeNull()
  })

  it('returns the resolved chatId once the entry exists', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'real-chat-id' })
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=meridian-product'))
    const data = await res.json()
    expect(data.chatId).toBe('real-chat-id')
    expect(h.resolveApp).toHaveBeenCalledWith('meridian-product')
  })

  it('returns chatId: null (never throws) if resolveApp rejects', async () => {
    h.resolveApp.mockRejectedValue(new Error('zerodb down'))
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=x'))
    const data = await res.json()
    expect(data.chatId).toBeNull()
  })
})
