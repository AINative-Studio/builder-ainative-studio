/**
 * #74 — POST /api/build/register email-verification honesty.
 *
 * Properties under test (core is MOCKED — no network):
 *   REGISTER:
 *     - invalid email / weak password are rejected before any core call,
 *     - a successful register surfaces `verificationRequired` from core's
 *       `email_verification_required` flag,
 *     - `user.email_verified === false` also raises verificationRequired,
 *     - the builder default (core auto-verifies) yields verificationRequired:false,
 *     - a core error is surfaced as a clean message (never {ok:true}),
 *   RESEND (action:'resend'):
 *     - invalid email → 400, no core call,
 *     - core 2xx → {ok:true}, core non-2xx → {ok:false},
 *   LOGIN-CHECK (action:'login-check'):
 *     - core 200 → {ok:true} (credentials are fine; something else failed),
 *     - core 403 AUTH_EMAIL_NOT_VERIFIED → {ok:false, errorCode} at HTTP 200,
 *     - the password is NEVER logged.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  gclidFromRequest: vi.fn(),
}))

vi.mock('@/lib/build/conversions', () => ({
  gclidFromRequest: h.gclidFromRequest,
}))

import { POST } from '@/app/api/build/register/route'

function req(body: unknown, cookie = '') {
  return {
    json: async () => body,
    headers: { get: (k: string) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  } as any
}

function coreOk(json: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

describe('POST /api/build/register — verification honesty (#74)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.gclidFromRequest.mockReset().mockReturnValue(null)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('register', () => {
    it('rejects an invalid email before calling core', async () => {
      const res = await POST(req({ email: 'nope', password: 'longenough1' }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_email')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a weak password before calling core', async () => {
      const res = await POST(req({ email: 'a@b.com', password: 'short' }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('weak_password')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('surfaces verificationRequired:true when core requires verification', async () => {
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: true, user: { email_verified: false } }))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1' }))
      const d = await res.json()
      expect(d.ok).toBe(true)
      expect(d.verificationRequired).toBe(true)
      expect(d.email).toBe('a@b.com')
    })

    it('raises verificationRequired from user.email_verified:false alone', async () => {
      fetchMock.mockResolvedValue(coreOk({ user: { email_verified: false } }))
      const d = await (await POST(req({ email: 'a@b.com', password: 'longenough1' }))).json()
      expect(d.verificationRequired).toBe(true)
    })

    it('reports verificationRequired:false for the builder auto-verify default', async () => {
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false, user: { email_verified: true } }))
      const d = await (await POST(req({ email: 'a@b.com', password: 'longenough1' }))).json()
      expect(d.ok).toBe(true)
      expect(d.verificationRequired).toBe(false)
    })

    it('surfaces a core error as a clean message, never ok:true', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ detail: 'email already registered' }) })
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1' }))
      expect(res.status).toBe(409)
      const d = await res.json()
      expect(d.ok).toBe(false)
      expect(d.error).toContain('already')
    })

    it('returns 502 when core is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('econnrefused'))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1' }))
      expect(res.status).toBe(502)
      expect((await res.json()).ok).toBe(false)
    })

    it('attaches gclid + parses the ax_utm cookie into the core payload', async () => {
      h.gclidFromRequest.mockReturnValue('CjwK-abc')
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false }))
      const cookie = 'ax_utm=' + encodeURIComponent(JSON.stringify({ utm_source: 's', utm_medium: 'm', utm_campaign: 'c' }))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1' }, cookie))
      const d = await res.json()
      expect(d.gclidAttached).toBe(true)
      const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
      expect(sent.ext.gclid).toBe('CjwK-abc')
      expect(sent.ext.utm).toEqual({ utm_source: 's', utm_medium: 'm', utm_campaign: 'c' })
    })

    it('falls back to google/cpc utm defaults when a gclid is present but ax_utm is absent', async () => {
      h.gclidFromRequest.mockReturnValue('CjwK-xyz')
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false }))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1' }))
      expect((await res.json()).gclidAttached).toBe(true)
      const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
      expect(sent.ext.utm.utm_source).toBe('google')
      expect(sent.ext.utm.utm_medium).toBe('cpc')
    })

    it('ignores a malformed ax_utm cookie without throwing', async () => {
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false }))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1' }, 'ax_utm=%7Bnot-json'))
      expect((await res.json()).ok).toBe(true)
    })
  })

  describe("action:'resend'", () => {
    it('rejects an invalid email with no core call', async () => {
      const res = await POST(req({ action: 'resend', email: 'nope' }))
      expect(res.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns ok:true when core accepts the resend', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: 'sent' }) })
      const res = await POST(req({ action: 'resend', email: 'a@b.com' }))
      expect((await res.json()).ok).toBe(true)
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('/api/v1/auth/resend-verification')
    })

    it('returns ok:false when core rejects the resend', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
      const res = await POST(req({ action: 'resend', email: 'a@b.com' }))
      expect(res.status).toBe(502)
      expect((await res.json()).ok).toBe(false)
    })

    it('returns 502 when core is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'))
      const res = await POST(req({ action: 'resend', email: 'a@b.com' }))
      expect(res.status).toBe(502)
    })
  })

  describe("action:'login-check'", () => {
    it('rejects a missing password/email', async () => {
      const res = await POST(req({ action: 'login-check', email: 'a@b.com' }))
      expect(res.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns ok:true when core login succeeds (not a verification issue)', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'x' }) })
      const res = await POST(req({ action: 'login-check', email: 'a@b.com', password: 'longenough1' }))
      expect((await res.json()).ok).toBe(true)
    })

    it('classifies AUTH_EMAIL_NOT_VERIFIED (403) as errorCode at HTTP 200', async () => {
      fetchMock.mockResolvedValue({
        ok: false, status: 403,
        json: async () => ({ error_code: 'AUTH_EMAIL_NOT_VERIFIED', detail: 'verify first' }),
      })
      const res = await POST(req({ action: 'login-check', email: 'a@b.com', password: 'longenough1' }))
      expect(res.status).toBe(200)
      const d = await res.json()
      expect(d.ok).toBe(false)
      expect(d.errorCode).toBe('AUTH_EMAIL_NOT_VERIFIED')
    })

    it('passes through a genuine credential failure code', async () => {
      fetchMock.mockResolvedValue({
        ok: false, status: 401,
        json: async () => ({ error_code: 'AUTH_INVALID_CREDENTIALS' }),
      })
      const res = await POST(req({ action: 'login-check', email: 'a@b.com', password: 'longenough1' }))
      expect(res.status).toBe(401)
      expect((await res.json()).errorCode).toBe('AUTH_INVALID_CREDENTIALS')
    })

    it('never logs the password', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
      await POST(req({ action: 'login-check', email: 'a@b.com', password: 'sup3rsecret!' }))
      const all = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ')
      expect(all).not.toContain('sup3rsecret!')
    })
  })
})
