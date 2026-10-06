/**
 * #950 — minimal server-side logging on a non-ok sendOtp result. Before
 * this, a founder's failed OTP send (e.g. the real 2026-10-06 case: Twilio
 * accepted the send but carrier delivery silently failed, error 30034) left
 * ZERO trace in Railway logs — the only way to investigate was querying
 * Twilio's API directly. Logs the `reason` only, never the phone number or
 * the code itself (PII/security — see the house convention of never logging
 * secrets in this codebase).
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

describe('POST /api/build/register — send-otp logging (#950)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>

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
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('logs the reason when sendOtp fails with a genuine send failure', async () => {
    h.sendOtp.mockResolvedValue({ ok: false, reason: 'send_failed: 30034 undelivered' })
    await POST(req({ action: 'send-otp', phone: '5550001111' }))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[otp]'), expect.stringContaining('send_failed'))
  })

  it('does NOT log the phone number or the OTP code itself', async () => {
    h.sendOtp.mockResolvedValue({ ok: false, reason: 'send_failed: 30034 undelivered' })
    await POST(req({ action: 'send-otp', phone: '5550001111' }))
    const loggedArgs = warnSpy.mock.calls.flat().join(' ')
    expect(loggedArgs).not.toContain('5550001111')
    expect(loggedArgs).not.toContain('+15550001111')
  })

  it('does NOT log anything on the honest not_configured gap (expected, not an error)', async () => {
    h.sendOtp.mockResolvedValue({ ok: false, reason: 'not_configured', expiresAt: 'x' })
    await POST(req({ action: 'send-otp', phone: '5550001111' }))
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does NOT log anything on a successful send', async () => {
    h.sendOtp.mockResolvedValue({ ok: true, expiresAt: 'x' })
    await POST(req({ action: 'send-otp', phone: '5550001111' }))
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
