import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1682 (original) → #1835 (supersedes it) — x402 Agent Payment Discovery.
 *
 * #1682 correctly found Builder itself has no business initiating on-chain
 * payments, and declared `x402_supported: false`. #1835 found that
 * conclusion never checked whether core (api.ainative.studio, the real
 * backend Builder is a client of) already had a real x402 discovery
 * document — it does (core#9247). This route now proxies core's real,
 * live document instead of serving a static "unsupported" answer that's
 * no longer true.
 */
describe('GET /.well-known/x402', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('proxies core real x402 discovery document verbatim on success', async () => {
    const coreDoc = {
      x402_version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'circle',
          asset: 'USDC',
          pay_to: '0x5631a4d7516da6bc2712f91dc8489637b87e2f52',
          resource: 'https://ainative-browser-builder.up.railway.app/api/v1/cloud/x402/subscriptions/subscribe',
          description: 'AINative Pro plan subscription',
        },
      ],
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => coreDoc,
    }) as unknown as typeof fetch

    const { GET } = await import('@/app/.well-known/x402/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc).toEqual(coreDoc)
    expect(doc.accepts[0].asset).toBe('USDC')
  })

  it('does not fabricate a payment capability when core is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch

    const { GET } = await import('@/app/.well-known/x402/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.accepts).toEqual([])
  })

  it('does not fabricate a payment capability when core returns a non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch

    const { GET } = await import('@/app/.well-known/x402/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.accepts).toEqual([])
  })

  it('fetches from the real core x402 endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ x402_version: 1, accepts: [] }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const { GET } = await import('@/app/.well-known/x402/route')
    await GET()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/.well-known/x402'),
      expect.any(Object),
    )
  })
})
