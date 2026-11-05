import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1838 (ACP execution half) — POST /checkout_sessions forwards to core's
 * REAL, live, Stripe-backed endpoint. This test suite MUST NEVER make a
 * real network call — global.fetch is mocked in every test. A real
 * end-to-end verification of this path is a deliberate, manual, single
 * curl call made outside the automated suite, never something vitest runs.
 */
describe('POST /checkout_sessions', () => {
  const originalFetch = global.fetch
  const originalSecret = process.env.ACP_SIGNING_SECRET

  beforeEach(() => {
    vi.resetModules()
    process.env.ACP_SIGNING_SECRET = 'test-shared-secret'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.ACP_SIGNING_SECRET = originalSecret
    vi.restoreAllMocks()
  })

  it('forwards to core with a valid Signature + Timestamp header pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: 'cs_test_123', status: 'ready_for_payment', checkout_url: 'https://checkout.stripe.com/test' }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/checkout_sessions/route')
    const req = new NextRequest('https://builder.ainative.studio/checkout_sessions', {
      method: 'POST',
      body: JSON.stringify({ items: [{ id: 'Pro', quantity: 1 }] }),
    })
    const res = await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/checkout_sessions')
    expect((init.headers as Record<string, string>).Signature).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect((init.headers as Record<string, string>).Timestamp).toMatch(/^\d+$/)

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('cs_test_123')
  })

  it('forwards the caller Idempotency-Key header verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{}',
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/checkout_sessions/route')
    const req = new NextRequest('https://builder.ainative.studio/checkout_sessions', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-idem-key-123' },
      body: JSON.stringify({ items: [{ id: 'Pro', quantity: 1 }] }),
    })
    await POST(req)

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('test-idem-key-123')
  })

  it('never calls core when ACP_SIGNING_SECRET is not configured', async () => {
    delete process.env.ACP_SIGNING_SECRET
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/checkout_sessions/route')
    const req = new NextRequest('https://builder.ainative.studio/checkout_sessions', {
      method: 'POST',
      body: JSON.stringify({ items: [{ id: 'Pro', quantity: 1 }] }),
    })
    const res = await POST(req)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
  })

  it('forwards a real upstream error without fabricating a success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ messages: [{ type: 'error', code: 'invalid_item', content: "'Bogus' is not a real AINative plan." }] }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/checkout_sessions/route')
    const req = new NextRequest('https://builder.ainative.studio/checkout_sessions', {
      method: 'POST',
      body: JSON.stringify({ items: [{ id: 'Bogus', quantity: 1 }] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.messages[0].code).toBe('invalid_item')
  })

  it('returns 502 (never a fabricated success) when core is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch

    const { POST } = await import('@/app/checkout_sessions/route')
    const req = new NextRequest('https://builder.ainative.studio/checkout_sessions', {
      method: 'POST',
      body: JSON.stringify({ items: [{ id: 'Pro', quantity: 1 }] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(502)
  })
})
