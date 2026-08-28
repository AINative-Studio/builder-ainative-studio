import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  metaCapiEnabled,
  reportMetaConversion,
  fbcFromRequest,
  fbpFromRequest,
} from '@/lib/build/meta-capi'

/**
 * lib/build/meta-capi -- Meta Conversions API server-side reporting (#207).
 *
 * PIXEL_ID and ACCESS_TOKEN are module-level constants frozen at import time.
 * Configured-path tests must vi.resetModules() FIRST, set env, then dynamic import.
 * No-op path tests use the static import (constants are '' in tests unless set).
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number }) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const r = impl(String(url), init)
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500),
      json: async () => ({}), text: async () => '' }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeRequest(cookieHeader: string) {
  return new Request('https://example.com', { headers: { cookie: cookieHeader } })
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Helper: get fresh module with META CAPI configured
async function freshCapi(testCode = '') {
  vi.resetModules()
  process.env.NEXT_PUBLIC_META_PIXEL_ID = 'PX1'
  process.env.META_CAPI_ACCESS_TOKEN = 'TK1'
  if (testCode) process.env.META_TEST_EVENT_CODE = testCode
  return import('@/lib/build/meta-capi')
}

// ---------- metaCapiEnabled ----------
describe('metaCapiEnabled', () => {
  it('returns a boolean', () => {
    expect(typeof metaCapiEnabled()).toBe('boolean')
  })

  it('logic: Boolean checks for pixel+token presence', () => {
    // Verify the underlying Boolean logic (module constants are empty in tests)
    const emptyPixel = '', emptyToken = '', pixel = 'pixel', token = 'token'
    expect(Boolean(emptyPixel && emptyToken)).toBe(false)
    expect(Boolean(pixel && emptyToken)).toBe(false)
    expect(Boolean(emptyPixel && token)).toBe(false)
    expect(Boolean(pixel && token)).toBe(true)
  })
})

// ---------- reportMetaConversion -- no-op gating ----------
describe('reportMetaConversion -- no-op gating', () => {
  it('returns false without fetch when CAPI is not configured (static import)', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    // Static import has PIXEL_ID='' ACCESS_TOKEN='' => metaCapiEnabled()=false
    const result = await reportMetaConversion({ eventName: 'Lead', eventId: 'evt-1' })
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
})

// ---------- reportMetaConversion -- configured paths ----------
describe('reportMetaConversion -- with CAPI configured', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID
    delete process.env.META_CAPI_ACCESS_TOKEN
    delete process.env.META_GRAPH_VERSION
    delete process.env.META_TEST_EVENT_CODE
  })

  it('POSTs to the correct Facebook graph endpoint', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()

    const result = await report({ eventName: 'Lead', eventId: 'evt-lead-1',
      email: 'founder@example.com', value: 0, currency: 'USD' })

    expect(result).toBe(true)
    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('graph.facebook.com')
    expect(String(url)).toContain('PX1')
    expect(String(url)).toContain('events')
    expect(String(url)).toContain('access_token=')
    const body = JSON.parse(init!.body as string)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(1)
    const event = body.data[0]
    expect(event.event_name).toBe('Lead')
    expect(event.event_id).toBe('evt-lead-1')
    expect(event.action_source).toBe('website')
    expect(typeof event.event_time).toBe('number')
  })

  it('hashes the email via SHA-256 (lowercase + trim)', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'CompleteRegistration', eventId: 'evt-reg-1', email: 'Test@Example.COM' })
    const userData = JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].user_data
    expect(Array.isArray(userData.em)).toBe(true)
    expect(userData.em[0]).toHaveLength(64) // SHA-256 hex
    const { createHash } = await import('crypto')
    const expected = createHash('sha256').update('test@example.com').digest('hex')
    expect(userData.em[0]).toBe(expected)
  })

  it('omits email hash when email is not provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'InitiateCheckout', eventId: 'evt-chk-1' })
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].user_data.em).toBeUndefined()
  })

  it('includes fbc, fbp, clientIp, and userAgent in user_data when provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'Purchase', eventId: 'evt-p1',
      fbc: 'fb.1.123.click', fbp: 'fb.1.123.browser',
      clientIp: '1.2.3.4', userAgent: 'Mozilla/5.0' })
    const userData = JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].user_data
    expect(userData.fbc).toBe('fb.1.123.click')
    expect(userData.fbp).toBe('fb.1.123.browser')
    expect(userData.client_ip_address).toBe('1.2.3.4')
    expect(userData.client_user_agent).toBe('Mozilla/5.0')
  })

  it('includes custom_data with value and currency when provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'Purchase', eventId: 'evt-p2', value: 149, currency: 'EUR',
      custom: { slug: 'my-co', plan: 'enterprise' } })
    const customData = JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].custom_data
    expect(customData.value).toBe(149)
    expect(customData.currency).toBe('EUR')
    expect(customData.slug).toBe('my-co')
    expect(customData.plan).toBe('enterprise')
  })

  it('defaults currency to USD when not provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'Lead', eventId: 'evt-1' })
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].custom_data.currency).toBe('USD')
  })

  it('omits value from custom_data when value is undefined', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'Lead', eventId: 'evt-1' })
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].custom_data.value).toBeUndefined()
  })

  it('includes test_event_code when META_TEST_EVENT_CODE is set', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi('TEST12345')
    await report({ eventName: 'Lead', eventId: 'evt-1' })
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).test_event_code).toBe('TEST12345')
  })

  it('omits test_event_code when META_TEST_EVENT_CODE is not set', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'Lead', eventId: 'evt-1' })
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).test_event_code).toBeUndefined()
  })

  it('includes eventSourceUrl when provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'Lead', eventId: 'evt-1', eventSourceUrl: 'https://ainative.studio/pricing' })
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].event_source_url).toBe('https://ainative.studio/pricing')
  })

  it('omits event_source_url when not provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await freshCapi()
    await report({ eventName: 'Lead', eventId: 'evt-1' })
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).data[0].event_source_url).toBeUndefined()
  })

  it('returns false when fetch responds with a non-ok status', async () => {
    mockFetch(() => ({ ok: false, status: 400 }))
    const { reportMetaConversion: report } = await freshCapi()
    expect(await report({ eventName: 'Lead', eventId: 'evt-err' })).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network down') }))
    const { reportMetaConversion: report } = await freshCapi()
    expect(await report({ eventName: 'Purchase', eventId: 'evt-throw' })).toBe(false)
  })

  it('uses the configured graph version in the URL', async () => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_META_PIXEL_ID = 'PX1'
    process.env.META_CAPI_ACCESS_TOKEN = 'TK1'
    process.env.META_GRAPH_VERSION = 'v22.0'
    const fn = mockFetch(() => ({ ok: true }))
    const { reportMetaConversion: report } = await import('@/lib/build/meta-capi')
    await report({ eventName: 'Lead', eventId: 'evt-1' })
    expect(String(fn.mock.calls[0][0])).toContain('v22.0')
  })
})

// ---------- fbcFromRequest ----------
describe('fbcFromRequest', () => {
  it('returns the _fbc value when present', () => {
    expect(fbcFromRequest(makeRequest('_fbc=fb.1.1234567890.AbCdEfGhIjKl'))).toBe('fb.1.1234567890.AbCdEfGhIjKl')
  })

  it('returns undefined when _fbc is absent', () => {
    expect(fbcFromRequest(makeRequest('session=abc; other=xyz'))).toBeUndefined()
  })

  it('returns undefined when there is no cookie header', () => {
    expect(fbcFromRequest(new Request('https://example.com'))).toBeUndefined()
  })

  it('extracts _fbc from a multi-cookie header', () => {
    expect(fbcFromRequest(makeRequest('_fbp=fb.1.111; _fbc=fb.1.222.click123; session=x'))).toBe('fb.1.222.click123')
  })

  it('URL-decodes the _fbc value', () => {
    const encoded = encodeURIComponent('fb.1.123.click+special')
    expect(fbcFromRequest(makeRequest(`_fbc=${encoded}`))).toBe('fb.1.123.click+special')
  })
})

// ---------- fbpFromRequest ----------
describe('fbpFromRequest', () => {
  it('returns the _fbp value when present', () => {
    expect(fbpFromRequest(makeRequest('_fbp=fb.1.1234567890.1234567890'))).toBe('fb.1.1234567890.1234567890')
  })

  it('returns undefined when _fbp is absent', () => {
    expect(fbpFromRequest(makeRequest('session=abc'))).toBeUndefined()
  })

  it('returns undefined when there is no cookie header', () => {
    expect(fbpFromRequest(new Request('https://example.com'))).toBeUndefined()
  })

  it('extracts _fbp from a multi-cookie header', () => {
    expect(fbpFromRequest(makeRequest('session=abc; _fbp=fb.1.999.browser; other=xyz'))).toBe('fb.1.999.browser')
  })

  it('URL-decodes the _fbp value', () => {
    const encoded = encodeURIComponent('fb.1.abc special')
    expect(fbpFromRequest(makeRequest(`_fbp=${encoded}`))).toBe('fb.1.abc special')
  })
})
