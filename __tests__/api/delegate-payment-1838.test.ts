import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1838 (ACP execution half) — POST /agentic_commerce/delegate_payment
 * forwards to core's REAL, live, Stripe-backed SetupIntent endpoint. Same
 * no-real-network-call rule as checkout-sessions-1838.test.ts.
 */
describe('POST /agentic_commerce/delegate_payment', () => {
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
      text: async () => JSON.stringify({ id: 'vt_seti_test_123', created: 1762300000, metadata: {} }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/agentic_commerce/delegate_payment/route')
    const req = new NextRequest('https://builder.ainative.studio/agentic_commerce/delegate_payment', {
      method: 'POST',
      body: JSON.stringify({
        payment_method: { type: 'CARD', id: 'pm_test_123' },
        allowance: { max_amount: 5000, currency: 'usd', expires_at: '2026-12-01T00:00:00Z' },
      }),
    })
    const res = await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/agentic_commerce/delegate_payment')
    expect((init.headers as Record<string, string>).Signature).toMatch(/^sha256=[0-9a-f]{64}$/)

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('vt_seti_test_123')
  })

  it('never calls core when ACP_SIGNING_SECRET is not configured', async () => {
    delete process.env.ACP_SIGNING_SECRET
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/agentic_commerce/delegate_payment/route')
    const req = new NextRequest('https://builder.ainative.studio/agentic_commerce/delegate_payment', {
      method: 'POST',
      body: JSON.stringify({ payment_method: { type: 'CARD', id: 'pm_test_123' }, allowance: { max_amount: 5000, currency: 'usd', expires_at: '2026-12-01T00:00:00Z' } }),
    })
    const res = await POST(req)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
  })
})

/**
 * #1840 (AP2) — POST /agentic_commerce/ap2/verify forwards to core's real
 * SD-JWT mandate verification. Pure verification, no signature needed —
 * also mocked, no real network call.
 */
describe('POST /agentic_commerce/ap2/verify', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('forwards the mandate to core and returns the real verification result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ result: 'success', reference: 'abc123', claims: {} }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/agentic_commerce/ap2/verify/route')
    const req = new NextRequest('https://builder.ainative.studio/agentic_commerce/ap2/verify', {
      method: 'POST',
      body: JSON.stringify({ mandate: 'eyJ...fake-sd-jwt' }),
    })
    const res = await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/agentic_commerce/ap2/verify')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toBe('success')
  })

  it('forwards a real verification failure without fabricating success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ result: 'error', error: 'invalid_credential', message: 'Mandate signature verification failed.' }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { POST } = await import('@/app/agentic_commerce/ap2/verify/route')
    const req = new NextRequest('https://builder.ainative.studio/agentic_commerce/ap2/verify', {
      method: 'POST',
      body: JSON.stringify({ mandate: 'bad-mandate' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.result).toBe('error')
  })
})
