import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reportConversion, gclidFromRequest } from '@/lib/build/conversions'

/**
 * lib/build/conversions — server-side Google Ads conversion reporting (#207).
 * Covers: reportConversion (no-gclid no-op, success, network failure, non-ok),
 * gclidFromRequest (present, absent, encoded, multiple cookies).
 * All fetch calls are mocked; no real network traffic.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeRequest(cookieHeader: string): Request {
  return new Request('https://example.com', {
    headers: { cookie: cookieHeader },
  })
}

describe('reportConversion (#207)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns false immediately when gclid is missing — no fetch call', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await reportConversion({
      eventType: 'conversion',
      eventName: 'subscribe',
      sessionId: 'sess-1',
      // no gclid
    })
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when gclid is empty string', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await reportConversion({
      eventType: 'conversion',
      eventName: 'subscribe',
      sessionId: 'sess-1',
      gclid: '',
    })
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('POSTs to /api/v1/events/track and returns true on success', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await reportConversion({
      eventType: 'conversion',
      eventName: 'subscribe',
      sessionId: 'sess-abc',
      gclid: 'gclid_xyz',
      value: 49,
      currency: 'USD',
      email: 'founder@co.com',
      slug: 'my-company',
      plan: 'pro',
    })
    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)

    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/api/v1/events/track')
    expect((init as RequestInit).method).toBe('POST')

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.event_type).toBe('conversion')
    expect(body.event_name).toBe('subscribe')
    expect(body.session_id).toBe('sess-abc')
    expect(body.google_ads_click_id).toBe('gclid_xyz')
    expect(body.conversion_value).toBe(49)
    expect(body.currency).toBe('USD')
    expect(body.form_data).toMatchObject({ source: 'builder', slug: 'my-company', plan: 'pro', email: 'founder@co.com' })
  })

  it('uses builder-{slug} as session_id fallback when sessionId is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await reportConversion({
      eventType: 'lead',
      eventName: 'lead',
      sessionId: '',
      gclid: 'g1',
      slug: 'my-co',
    })
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.session_id).toBe('builder-my-co')
  })

  it('uses builder-anon as session_id fallback when sessionId and slug are empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await reportConversion({
      eventType: 'lead',
      eventName: 'lead',
      sessionId: '',
      gclid: 'g1',
    })
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.session_id).toBe('builder-anon')
  })

  it('defaults currency to USD when not specified', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await reportConversion({
      eventType: 'conversion',
      eventName: 'purchase',
      sessionId: 's1',
      gclid: 'g1',
    })
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.currency).toBe('USD')
  })

  it('returns false when the API responds with a non-ok status', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const result = await reportConversion({
      eventType: 'conversion',
      eventName: 'subscribe',
      sessionId: 's1',
      gclid: 'g1',
    })
    expect(result).toBe(false)
  })

  it('returns false when the API responds with 4xx', async () => {
    mockFetch(() => ({ ok: false, status: 401 }))
    const result = await reportConversion({
      eventType: 'conversion',
      eventName: 'subscribe',
      sessionId: 's1',
      gclid: 'g1',
    })
    expect(result).toBe(false)
  })

  it('returns false (never throws) when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network error') }))
    const result = await reportConversion({
      eventType: 'conversion',
      eventName: 'subscribe',
      sessionId: 's1',
      gclid: 'g1',
    })
    expect(result).toBe(false)
  })

  it('sends optional fields (value, email, plan, slug) when provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await reportConversion({
      eventType: 'conversion',
      eventName: 'purchase',
      sessionId: 'sess-x',
      gclid: 'g1',
      value: 99,
      email: 'user@test.com',
      plan: 'enterprise',
      slug: 'test-co',
    })
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.conversion_value).toBe(99)
    expect(body.form_data.email).toBe('user@test.com')
    expect(body.form_data.plan).toBe('enterprise')
    expect(body.form_data.slug).toBe('test-co')
  })
})

describe('gclidFromRequest (#207)', () => {
  it('returns the gclid when ax_gclid cookie is present', () => {
    const req = makeRequest('ax_gclid=Cj0KCQiA_bieBhDSARIsADU4zLf1234')
    expect(gclidFromRequest(req)).toBe('Cj0KCQiA_bieBhDSARIsADU4zLf1234')
  })

  it('returns undefined when the ax_gclid cookie is absent', () => {
    const req = makeRequest('session=abc; other=xyz')
    expect(gclidFromRequest(req)).toBeUndefined()
  })

  it('returns undefined when there is no cookie header', () => {
    const req = new Request('https://example.com')
    expect(gclidFromRequest(req)).toBeUndefined()
  })

  it('extracts gclid from a multi-cookie string with ax_gclid in the middle', () => {
    const req = makeRequest('session=abc; ax_gclid=MY_GCLID_VALUE; other=xyz')
    expect(gclidFromRequest(req)).toBe('MY_GCLID_VALUE')
  })

  it('decodes URL-encoded gclid values', () => {
    const encoded = encodeURIComponent('Cj0K+special/chars==')
    const req = makeRequest(`ax_gclid=${encoded}`)
    expect(gclidFromRequest(req)).toBe('Cj0K+special/chars==')
  })

  it('handles gclid as the first cookie (no leading semicolon)', () => {
    const req = makeRequest('ax_gclid=first_cookie')
    expect(gclidFromRequest(req)).toBe('first_cookie')
  })

  it('handles gclid as the last cookie', () => {
    const req = makeRequest('session=abc; ax_gclid=last_one')
    expect(gclidFromRequest(req)).toBe('last_one')
  })

  it('returns undefined for an empty cookie header', () => {
    const req = makeRequest('')
    expect(gclidFromRequest(req)).toBeUndefined()
  })
})
