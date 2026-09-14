/**
 * #734 — POST /api/build/register's new phone OTP actions
 * ({action:'send-otp'}, {action:'verify-otp'}) plus phone capture on
 * register. lib/build/otp.ts and lib/build/founder-phones.ts are mocked —
 * this file tests only the route's dispatch/validation/response-shape
 * contract, not ZeroDB/ZeroVoice themselves (those have their own direct
 * unit tests in __tests__/lib/build/otp.test.ts).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  gclidFromRequest: vi.fn(),
  reportMetaConversion: vi.fn(),
  fbcFromRequest: vi.fn(),
  fbpFromRequest: vi.fn(),
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  checkOtpRateLimit: vi.fn(),
  recordFounderPhone: vi.fn(),
  markFounderPhoneVerified: vi.fn(),
}))

vi.mock('@/lib/build/conversions', () => ({ gclidFromRequest: h.gclidFromRequest }))
vi.mock('@/lib/build/meta-capi', () => ({
  reportMetaConversion: h.reportMetaConversion,
  fbcFromRequest: h.fbcFromRequest,
  fbpFromRequest: h.fbpFromRequest,
}))
vi.mock('@/lib/build/otp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/otp')>('@/lib/build/otp')
  return {
    ...actual,
    sendOtp: h.sendOtp,
    verifyOtp: h.verifyOtp,
    checkOtpRateLimit: h.checkOtpRateLimit,
  }
})
vi.mock('@/lib/build/founder-phones', () => ({
  recordFounderPhone: h.recordFounderPhone,
  markFounderPhoneVerified: h.markFounderPhoneVerified,
}))

import { POST } from '@/app/api/build/register/route'

function req(body: unknown, opts: { cookie?: string; ip?: string } = {}) {
  return {
    json: async () => body,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase()
        if (key === 'cookie') return opts.cookie || null
        if (key === 'x-forwarded-for') return opts.ip || null
        return null
      },
    },
  } as any
}

function coreOk(json: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

describe('POST /api/build/register — phone OTP actions (#734)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.gclidFromRequest.mockReset().mockReturnValue(null)
    h.reportMetaConversion.mockReset().mockResolvedValue(true)
    h.fbcFromRequest.mockReset().mockReturnValue(undefined)
    h.fbpFromRequest.mockReset().mockReturnValue(undefined)
    h.sendOtp.mockReset()
    h.verifyOtp.mockReset()
    h.checkOtpRateLimit.mockReset().mockReturnValue({ ok: true })
    h.recordFounderPhone.mockReset().mockResolvedValue(true)
    h.markFounderPhoneVerified.mockReset().mockResolvedValue(true)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe("action:'send-otp'", () => {
    it('rejects an invalid phone before calling sendOtp', async () => {
      const res = await POST(req({ action: 'send-otp', phone: 'not-a-phone' }))
      expect(res.status).toBe(400)
      expect((await res.json()).reason).toBe('invalid_phone')
      expect(h.sendOtp).not.toHaveBeenCalled()
    })

    it('normalizes the phone to E.164 before checking rate limit / sending', async () => {
      h.sendOtp.mockResolvedValue({ ok: true, expiresAt: '2026-09-13T00:10:00.000Z' })
      const res = await POST(req({ action: 'send-otp', phone: '(555) 000-1111' }))
      expect(res.status).toBe(200)
      expect(h.checkOtpRateLimit).toHaveBeenCalledWith('+15550001111', expect.any(String))
      expect(h.sendOtp).toHaveBeenCalledWith('+15550001111')
    })

    it('returns 429 when rate-limited, before calling sendOtp', async () => {
      h.checkOtpRateLimit.mockReturnValue({ ok: false, reason: 'rate_limited_phone' })
      const res = await POST(req({ action: 'send-otp', phone: '5550001111' }))
      expect(res.status).toBe(429)
      expect((await res.json()).reason).toBe('rate_limited_phone')
      expect(h.sendOtp).not.toHaveBeenCalled()
    })

    it('returns the honest not_configured failure at HTTP 200 (not an error status)', async () => {
      h.sendOtp.mockResolvedValue({ ok: false, reason: 'not_configured', expiresAt: '2026-09-13T00:10:00.000Z' })
      const res = await POST(req({ action: 'send-otp', phone: '5550001111' }))
      expect(res.status).toBe(200)
      const d = await res.json()
      expect(d.ok).toBe(false)
      expect(d.reason).toBe('not_configured')
    })

    it('returns 502 for a genuine send failure', async () => {
      h.sendOtp.mockResolvedValue({ ok: false, reason: 'send_failed' })
      const res = await POST(req({ action: 'send-otp', phone: '5550001111' }))
      expect(res.status).toBe(502)
    })

    it('uses the client IP from x-forwarded-for for rate limiting', async () => {
      h.sendOtp.mockResolvedValue({ ok: true, expiresAt: 'x' })
      await POST(req({ action: 'send-otp', phone: '5550001111' }, { ip: '203.0.113.5' }))
      expect(h.checkOtpRateLimit).toHaveBeenCalledWith('+15550001111', '203.0.113.5')
    })
  })

  describe("action:'verify-otp'", () => {
    it('rejects a missing phone/code', async () => {
      const res = await POST(req({ action: 'verify-otp', phone: '', code: '123456' }))
      expect(res.status).toBe(400)
      expect(h.verifyOtp).not.toHaveBeenCalled()
    })

    it('returns ok:true and records phone-verified on success', async () => {
      h.verifyOtp.mockResolvedValue({ ok: true })
      const res = await POST(req({ action: 'verify-otp', phone: '5550001111', code: '123456', email: 'a@b.com' }))
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)
      expect(h.verifyOtp).toHaveBeenCalledWith('+15550001111', '123456')
      expect(h.markFounderPhoneVerified).toHaveBeenCalledWith('a@b.com', '+15550001111')
    })

    it('returns 400 with the reason on mismatch, without marking verified', async () => {
      h.verifyOtp.mockResolvedValue({ ok: false, reason: 'mismatch' })
      const res = await POST(req({ action: 'verify-otp', phone: '5550001111', code: '000000' }))
      expect(res.status).toBe(400)
      expect((await res.json()).reason).toBe('mismatch')
      expect(h.markFounderPhoneVerified).not.toHaveBeenCalled()
    })

    it('returns 400 on an expired code', async () => {
      h.verifyOtp.mockResolvedValue({ ok: false, reason: 'expired' })
      const res = await POST(req({ action: 'verify-otp', phone: '5550001111', code: '123456' }))
      expect(res.status).toBe(400)
      expect((await res.json()).reason).toBe('expired')
    })
  })

  describe('register with phone', () => {
    it('records the normalized phone after a successful core registration', async () => {
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false }))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1', phone: '5550001111' }))
      expect((await res.json()).ok).toBe(true)
      expect(h.recordFounderPhone).toHaveBeenCalledWith('a@b.com', '+15550001111')
    })

    it('does not call recordFounderPhone when no phone was submitted', async () => {
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false }))
      await POST(req({ email: 'a@b.com', password: 'longenough1' }))
      expect(h.recordFounderPhone).not.toHaveBeenCalled()
    })

    it('does not block registration when the phone is invalid (silently skipped)', async () => {
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false }))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1', phone: 'nope' }))
      expect((await res.json()).ok).toBe(true)
      expect(h.recordFounderPhone).not.toHaveBeenCalled()
    })

    it('does not block registration when recordFounderPhone rejects', async () => {
      h.recordFounderPhone.mockRejectedValue(new Error('zerodb down'))
      fetchMock.mockResolvedValue(coreOk({ email_verification_required: false }))
      const res = await POST(req({ email: 'a@b.com', password: 'longenough1', phone: '5550001111' }))
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)
    })
  })
})
