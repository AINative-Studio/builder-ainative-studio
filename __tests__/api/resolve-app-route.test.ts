import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET /api/build/resolve-app — polling counterpart to company-product's
 * decoupled generation (issue #629/#631/#633, 2026-09-10). company-product
 * now returns { status: 'processing' } immediately and runs the real
 * generation as a detached background task (Railway's edge proxy has its
 * own hard request timeout around 300s that a real generation + primitive-
 * compliance repair round-trip can legitimately exceed — confirmed live).
 * The client polls this endpoint until registerApp lands.
 *
 * #807/#832: `verified` distinguishes "this company doesn't exist" from
 * "resolveApp's own registry fetch failed" — both used to serialize as the
 * identical { chatId: null, idea: null }, which caused a real, signed-in
 * customer's "Open dashboard" click to bounce back to the companies screen
 * on a transient upstream hiccup, not a genuine missing company.
 */

const h = vi.hoisted(() => ({
  resolveAppVerified: vi.fn(async (): Promise<{ entry: { chatId: string } | null; verified: boolean }> => ({ entry: null, verified: true })),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))

import { GET } from '@/app/api/build/resolve-app/route'

function req(url: string) {
  return { url } as any
}

describe('GET /api/build/resolve-app', () => {
  beforeEach(() => { h.resolveAppVerified.mockReset().mockResolvedValue({ entry: null, verified: true }) })
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
    h.resolveAppVerified.mockResolvedValue({ entry: { chatId: 'real-chat-id' }, verified: true })
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=meridian-product'))
    const data = await res.json()
    expect(data.chatId).toBe('real-chat-id')
    expect(h.resolveAppVerified).toHaveBeenCalledWith('meridian-product')
  })

  it('returns chatId: null (never throws) if resolveAppVerified rejects', async () => {
    h.resolveAppVerified.mockRejectedValue(new Error('zerodb down'))
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=x'))
    const data = await res.json()
    expect(data.chatId).toBeNull()
  })

  // #660: Live.tsx hydrates client-only state.idea from this endpoint on a
  // fresh page load — a new tab/reload/returning visit never has it in
  // memory, so without this the real-product-generation trigger silently
  // never fires. Additive field, existing chatId-only callers unaffected.
  it('also returns the registry idea when one is recorded', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { chatId: 'real-chat-id', idea: 'A hot sauce subscription box' } as any, verified: true })
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=ember-box'))
    const data = await res.json()
    expect(data.idea).toBe('A hot sauce subscription box')
  })

  it('returns idea: null when the registry entry has no idea recorded', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { chatId: 'real-chat-id' } as any, verified: true })
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=ember-box'))
    const data = await res.json()
    expect(data.idea).toBeNull()
  })

  // #743: Live.tsx's comms-mode selector hydrates its current value from this
  // endpoint. Additive field, existing callers unaffected.
  it('defaults commsMode to agile when the registry entry has none recorded', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { chatId: 'real-chat-id' } as any, verified: true })
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=ember-box'))
    const data = await res.json()
    expect(data.commsMode).toBe('agile')
  })

  it('returns the registry commsMode when pairProgramming was chosen', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { chatId: 'real-chat-id', commsMode: 'pairProgramming' } as any, verified: true })
    const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=ember-box'))
    const data = await res.json()
    expect(data.commsMode).toBe('pairProgramming')
  })

  // #807/#832
  describe('verified field (#807/#832)', () => {
    it('returns verified:true for a genuine, confirmed miss', async () => {
      h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
      const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=never-existed'))
      const data = await res.json()
      expect(data.chatId).toBeNull()
      expect(data.verified).toBe(true)
    })

    it('returns verified:false when resolveAppVerified reports an unconfirmed failure', async () => {
      h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
      const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=agentive'))
      const data = await res.json()
      expect(data.chatId).toBeNull()
      expect(data.verified).toBe(false)
    })

    it('returns verified:false (not true) when resolveAppVerified itself throws', async () => {
      h.resolveAppVerified.mockRejectedValue(new Error('zerodb down'))
      const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=agentive'))
      const data = await res.json()
      expect(data.verified).toBe(false)
    })

    it('returns verified:true alongside a real, confirmed entry', async () => {
      h.resolveAppVerified.mockResolvedValue({ entry: { chatId: 'real-chat-id' } as any, verified: true })
      const res = await GET(req('https://builder.ainative.studio/api/build/resolve-app?slug=ember-box'))
      const data = await res.json()
      expect(data.chatId).toBe('real-chat-id')
      expect(data.verified).toBe(true)
    })
  })
})
