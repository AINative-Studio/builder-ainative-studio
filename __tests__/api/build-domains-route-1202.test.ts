import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2 follow-up) — app/api/build/domains/route.ts (#207/#240)
 * had zero route-level coverage. All real I/O (fetch to core, auth, the app
 * registry write) is mocked at the boundary.
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const appRegistry = vi.hoisted(() => ({ setAppDomain: vi.fn() }))
vi.mock('@/lib/build/app-registry', () => ({ setAppDomain: appRegistry.setAppDomain }))

vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => 'test-key' }))

import { mockGetRequest, mockJsonRequest } from '../helpers/api-route-harness'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  appRegistry.setAppDomain.mockResolvedValue(true)
})

function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data } as any
}

describe('#1202 GET /api/build/domains', () => {
  it('returns availability for an exact domain check', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ configured: true, suggestions: [] }))
    const { GET } = await import('@/app/api/build/domains/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/domains?check=acme.com'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.configured).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/public/domains/check?domain=acme.com'),
      expect.any(Object)
    )
  })

  it('degrades gracefully for an exact check when core is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network blip'))
    const { GET } = await import('@/app/api/build/domains/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/domains?check=acme.com'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ configured: false, suggestions: [] })
  })

  it('returns 400 when brand is missing for suggestions', async () => {
    const { GET } = await import('@/app/api/build/domains/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/domains'))

    expect(res.status).toBe(400)
  })

  it('returns suggestions for a brand, including keywords and offset in the query', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ configured: true, suggestions: ['acme.io'] }))
    const { GET } = await import('@/app/api/build/domains/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/build/domains?brand=acme&keywords=coffee&offset=10')
    )

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('brand=acme'),
      expect.any(Object)
    )
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('keywords=coffee')
    expect(calledUrl).toContain('offset=10')
  })

  it('degrades gracefully for suggestions when core throws', async () => {
    fetchMock.mockRejectedValue(new Error('network blip'))
    const { GET } = await import('@/app/api/build/domains/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/domains?brand=acme'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ configured: false, suggestions: [] })
  })
})

describe('#1202 POST /api/build/domains', () => {
  it('returns 400 when domain or slug is missing', async () => {
    const { POST } = await import('@/app/api/build/domains/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/domains', { domain: 'acme.com' }))

    expect(res.status).toBe(400)
  })

  it('returns a signin prompt when the founder is not signed in', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/domains/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/domains', { domain: 'acme.com', slug: 'acme' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: false, reason: 'signin' })
  })

  it('starts a Stripe checkout session for a signed-in founder', async () => {
    auth.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'founder@x.com' } })
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, url: 'https://checkout.stripe.com/abc' }))
    const { POST } = await import('@/app/api/build/domains/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/domains', { domain: 'acme.com', slug: 'acme' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain('checkout.stripe.com')
  })

  it('propagates a non-ok status from core', async () => {
    auth.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'founder@x.com' } })
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'domain taken' }, false, 409))
    const { POST } = await import('@/app/api/build/domains/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/domains', { domain: 'acme.com', slug: 'acme' })
    )

    expect(res.status).toBe(409)
  })

  it('returns 502 when the checkout request throws', async () => {
    auth.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'founder@x.com' } })
    fetchMock.mockRejectedValue(new Error('network blip'))
    const { POST } = await import('@/app/api/build/domains/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/domains', { domain: 'acme.com', slug: 'acme' })
    )

    expect(res.status).toBe(502)
  })
})

describe('#1202 PUT /api/build/domains', () => {
  it('returns 400 when session_id is missing', async () => {
    const { PUT } = await import('@/app/api/build/domains/route')

    const res = await PUT(mockJsonRequest('http://localhost/api/build/domains', {}, { method: 'PUT' }))

    expect(res.status).toBe(400)
  })

  it('fulfills and persists the domain on the company when registered', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, registered: true, domain: 'acme.com', slug: 'acme' }))
    const { PUT } = await import('@/app/api/build/domains/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/build/domains', { session_id: 'cs_123' }, { method: 'PUT' })
    )

    expect(res.status).toBe(200)
    expect(appRegistry.setAppDomain).toHaveBeenCalledWith('acme', 'acme.com')
  })

  it('does not persist a domain when fulfillment did not actually register it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, domain: 'acme.com', slug: 'acme' }))
    const { PUT } = await import('@/app/api/build/domains/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/build/domains', { session_id: 'cs_123' }, { method: 'PUT' })
    )

    expect(res.status).toBe(200)
    expect(appRegistry.setAppDomain).not.toHaveBeenCalled()
  })

  it('returns 502 when the fulfillment request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network blip'))
    const { PUT } = await import('@/app/api/build/domains/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/build/domains', { session_id: 'cs_123' }, { method: 'PUT' })
    )

    expect(res.status).toBe(502)
  })
})
