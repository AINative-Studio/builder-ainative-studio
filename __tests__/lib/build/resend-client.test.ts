import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

/**
 * lib/build/resend-client — shared low-level Resend HTTP client (#733),
 * extracted out of lib/growth/winback-email.ts's inline sendViaResend so both
 * winback emails and general-purpose company emails share one real
 * implementation. Covers: missing-key guard, missing-field guards, the real
 * request shape, success, and honest failure surfacing. All fetch calls are
 * mocked — no real email is ever sent by these tests.
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
  vi.resetModules()
})

describe('sendViaResend (#733)', () => {
  it('returns { ok: false, reason: "no_resend_api_key" } when RESEND_API_KEY is unset', async () => {
    vi.resetModules()
    delete process.env.RESEND_API_KEY
    const { sendViaResend } = await import('@/lib/build/resend-client')
    const fn = mockFetch(() => ({ ok: true }))
    const result = await sendViaResend('Co <noreply@x.com>', 'to@x.com', 'subj', '<p>hi</p>', 'hi')
    expect(result).toEqual({ ok: false, reason: 'no_resend_api_key' })
    expect(fn).not.toHaveBeenCalled()
  })

  describe('with RESEND_API_KEY set', () => {
    beforeEach(() => {
      vi.resetModules()
      process.env.RESEND_API_KEY = 're_test_key'
    })

    it('returns { ok: false, reason: "no_recipient" } when to is empty', async () => {
      const { sendViaResend } = await import('@/lib/build/resend-client')
      const fn = mockFetch(() => ({ ok: true }))
      const result = await sendViaResend('Co <noreply@x.com>', '', 'subj', '<p>hi</p>', 'hi')
      expect(result).toEqual({ ok: false, reason: 'no_recipient' })
      expect(fn).not.toHaveBeenCalled()
    })

    it('returns { ok: false, reason: "no_subject" } when subject is empty', async () => {
      const { sendViaResend } = await import('@/lib/build/resend-client')
      const fn = mockFetch(() => ({ ok: true }))
      const result = await sendViaResend('Co <noreply@x.com>', 'to@x.com', '', '<p>hi</p>', 'hi')
      expect(result).toEqual({ ok: false, reason: 'no_subject' })
      expect(fn).not.toHaveBeenCalled()
    })

    it('sends the real request shape and returns the id on success', async () => {
      const { sendViaResend } = await import('@/lib/build/resend-client')
      const fn = mockFetch((url) => {
        expect(url).toBe('https://api.resend.com/emails')
        return { ok: true, status: 200, json: { id: 'email-123' } }
      })
      const result = await sendViaResend('Co <noreply@x.com>', 'to@x.com', 'subj', '<p>hi</p>', 'hi')
      expect(result).toEqual({ ok: true, id: 'email-123', status: 200 })
      const call = fn.mock.calls[0]
      expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer re_test_key' })
      const body = JSON.parse((call[1] as RequestInit).body as string)
      expect(body).toEqual({ from: 'Co <noreply@x.com>', to: 'to@x.com', subject: 'subj', html: '<p>hi</p>', text: 'hi' })
    })

    it('returns the real failure reason on a non-2xx response', async () => {
      const { sendViaResend } = await import('@/lib/build/resend-client')
      mockFetch(() => ({ ok: false, status: 403, json: { message: 'domain not verified' } }))
      const result = await sendViaResend('Co <noreply@x.com>', 'to@x.com', 'subj', '<p>hi</p>', 'hi')
      expect(result.ok).toBe(false)
      expect(result.status).toBe(403)
      expect(result.reason).toContain('domain not verified')
    })

    it('never throws when fetch throws a network error', async () => {
      const { sendViaResend } = await import('@/lib/build/resend-client')
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
      const result = await sendViaResend('Co <noreply@x.com>', 'to@x.com', 'subj', '<p>hi</p>', 'hi')
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('Connection refused')
    })
  })
})

describe('resendConfigured (#733)', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('is false when RESEND_API_KEY is unset', async () => {
    vi.resetModules()
    delete process.env.RESEND_API_KEY
    const { resendConfigured } = await import('@/lib/build/resend-client')
    expect(resendConfigured()).toBe(false)
  })

  it('is true when RESEND_API_KEY is set', async () => {
    vi.resetModules()
    process.env.RESEND_API_KEY = 're_test_key'
    const { resendConfigured } = await import('@/lib/build/resend-client')
    expect(resendConfigured()).toBe(true)
  })
})
