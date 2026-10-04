import { describe, it, expect, vi, afterEach } from 'vitest'
import { turnstileEnabled, verifyTurnstileToken } from '@/lib/turnstile'

/**
 * lib/turnstile — Cloudflare Turnstile server-side verification (#930).
 * All fetch calls are mocked — no real Cloudflare siteverify call is ever
 * made by these tests.
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

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('turnstileEnabled', () => {
  it('is false when TURNSTILE_SECRET_KEY is unset', () => {
    delete process.env.TURNSTILE_SECRET_KEY
    expect(turnstileEnabled()).toBe(false)
  })

  it('is true when TURNSTILE_SECRET_KEY is set', () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    expect(turnstileEnabled()).toBe(true)
  })
})

describe('verifyTurnstileToken', () => {
  it('fails closed when the secret key is not configured', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    const result = await verifyTurnstileToken('some-token')
    expect(result).toEqual({ success: false, reason: 'turnstile_not_configured' })
  })

  it('fails closed when the token is missing', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    const result = await verifyTurnstileToken(null)
    expect(result).toEqual({ success: false, reason: 'missing_token' })
  })

  it('fails closed when the token is an empty string', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    const result = await verifyTurnstileToken('')
    expect(result).toEqual({ success: false, reason: 'missing_token' })
  })

  it('returns success when Cloudflare confirms the token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    mockFetch((url) => {
      expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
      return { ok: true, json: { success: true } }
    })
    const result = await verifyTurnstileToken('real-token')
    expect(result).toEqual({ success: true })
  })

  it('sends the secret, response, and remoteip in the POST body', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'my-secret'
    const fetchMock = mockFetch(() => ({ ok: true, json: { success: true } }))
    await verifyTurnstileToken('tok-123', '1.2.3.4')

    const [, init] = fetchMock.mock.calls[0]
    const body = init?.body as URLSearchParams
    expect(body.get('secret')).toBe('my-secret')
    expect(body.get('response')).toBe('tok-123')
    expect(body.get('remoteip')).toBe('1.2.3.4')
  })

  it('omits remoteip when not provided', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'my-secret'
    const fetchMock = mockFetch(() => ({ ok: true, json: { success: true } }))
    await verifyTurnstileToken('tok-123')

    const [, init] = fetchMock.mock.calls[0]
    const body = init?.body as URLSearchParams
    expect(body.has('remoteip')).toBe(false)
  })

  it('returns the real error-codes reason when Cloudflare rejects the token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    mockFetch(() => ({ ok: true, json: { success: false, 'error-codes': ['invalid-input-response'] } }))
    const result = await verifyTurnstileToken('bad-token')
    expect(result).toEqual({ success: false, reason: 'invalid-input-response' })
  })

  it('fails closed when Cloudflare returns a non-ok HTTP status', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    mockFetch(() => ({ ok: false, status: 500, json: { success: false } }))
    const result = await verifyTurnstileToken('tok')
    expect(result.success).toBe(false)
  })

  it('fails closed, never throws, when the response is not valid JSON', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => { throw new Error('bad json') } }) as unknown as Response),
    )
    const result = await verifyTurnstileToken('tok')
    expect(result).toEqual({ success: false, reason: 'invalid_verify_response' })
  })

  it('fails closed, never throws, on a network error', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await verifyTurnstileToken('tok')
    expect(result.success).toBe(false)
    expect(result.reason).toMatch(/network down/)
  })
})
