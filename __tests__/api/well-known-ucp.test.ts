import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1838 (discovery half) — UCP (Universal Commerce Protocol) discovery.
 * Proxies core's real, live /.well-known/ucp document (core#9247) rather
 * than inventing a second, possibly-drifting copy of what commerce
 * capabilities actually exist.
 */
describe('GET /.well-known/ucp', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('proxies core real UCP discovery document verbatim on success', async () => {
    const coreDoc = {
      version: '2026-10-27',
      capabilities: [
        { type: 'subscription', description: 'Real Stripe-backed subscription plans.', plans: [{ name: 'Pro' }] },
        { type: 'x402', description: 'HTTP 402-based crypto micropayments.', asset: 'USDC', network: 'circle' },
        { type: 'ap2', description: 'Agent Payments Protocol mandate verification.', mandate_types_supported: ['intent', 'cart', 'payment'] },
      ],
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => coreDoc }) as unknown as typeof fetch

    const { GET } = await import('@/app/.well-known/ucp/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc).toEqual(coreDoc)
  })

  it('does not fabricate capabilities when core is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch

    const { GET } = await import('@/app/.well-known/ucp/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.capabilities).toEqual([])
  })
})
