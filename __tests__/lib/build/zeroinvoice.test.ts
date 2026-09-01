import { describe, it, expect, vi, afterEach } from 'vitest'
import { getZeroInvoiceAuthorizeUrl } from '@/lib/build/zeroinvoice'

/**
 * lib/build/zeroinvoice — ZeroInvoice connect client (#418).
 * Covers: the real authorize-URL fetch, error shapes (including
 * ZeroInvoice's own "SSO not configured" 503), a malformed success
 * response, and never-throws. All fetch calls are mocked.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getZeroInvoiceAuthorizeUrl (#418)', () => {
  it('returns the real auth_url on success', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: { auth_url: 'https://api.ainative.studio/oauth/authorize?client_id=x&state=y', state: 'y' },
    }))
    const result = await getZeroInvoiceAuthorizeUrl()
    expect(result).toEqual({ ok: true, authUrl: 'https://api.ainative.studio/oauth/authorize?client_id=x&state=y', status: 200 })
    const [url] = fn.mock.calls[0]
    expect(String(url)).toContain('/auth/ainative/authorize')
  })

  it('returns { ok: false, reason: "authorize_response_missing_auth_url" } when auth_url is absent', async () => {
    mockFetch(() => ({ ok: true, json: { state: 'y' } }))
    const result = await getZeroInvoiceAuthorizeUrl()
    expect(result).toEqual({ ok: false, reason: 'authorize_response_missing_auth_url' })
  })

  it('surfaces the real 503 "SSO not configured" error honestly', async () => {
    mockFetch(() => ({
      ok: false,
      status: 503,
      json: { detail: 'AINative SSO not configured — client_id missing. Please sign in with email & password.' },
    }))
    const result = await getZeroInvoiceAuthorizeUrl()
    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
    expect(result.reason).toContain('AINative SSO not configured')
  })

  it('falls back to status code string when data has no detail/message', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: {} }))
    const result = await getZeroInvoiceAuthorizeUrl()
    expect(result).toEqual({ ok: false, status: 500, reason: '500' })
  })

  it('never throws when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await getZeroInvoiceAuthorizeUrl()
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })

  it('truncates reason to 160 chars for extremely long error messages', async () => {
    const longMessage = 'x'.repeat(300)
    mockFetch(() => ({ ok: false, status: 500, json: { detail: longMessage } }))
    const result = await getZeroInvoiceAuthorizeUrl()
    expect((result.reason ?? '').length).toBeLessThanOrEqual(160)
  })
})
