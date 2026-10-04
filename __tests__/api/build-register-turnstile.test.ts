/**
 * #933 — POST /api/build/register (action: register, the real /build signup
 * path) gates on Turnstile verification, same as the legacy /register page
 * got in #931. Core and lib/turnstile are both mocked — no real network.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  gclidFromRequest: vi.fn(),
  reportMetaConversion: vi.fn(),
  fbcFromRequest: vi.fn(),
  fbpFromRequest: vi.fn(),
  turnstileEnabled: vi.fn(),
  verifyTurnstileToken: vi.fn(),
}))

vi.mock('@/lib/build/conversions', () => ({
  gclidFromRequest: h.gclidFromRequest,
}))

vi.mock('@/lib/build/meta-capi', () => ({
  reportMetaConversion: h.reportMetaConversion,
  fbcFromRequest: h.fbcFromRequest,
  fbpFromRequest: h.fbpFromRequest,
}))

vi.mock('@/lib/turnstile', () => ({
  turnstileEnabled: h.turnstileEnabled,
  verifyTurnstileToken: h.verifyTurnstileToken,
}))

import { POST } from '@/app/api/build/register/route'

function req(body: unknown, cookie = '', ip = '1.2.3.4') {
  return {
    json: async () => body,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase()
        if (key === 'cookie') return cookie
        if (key === 'x-forwarded-for') return ip
        return null
      },
    },
  } as any
}

function coreOk(json: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

describe('POST /api/build/register — Turnstile gating (#933)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.gclidFromRequest.mockReset().mockReturnValue(null)
    h.reportMetaConversion.mockReset().mockResolvedValue(true)
    h.fbcFromRequest.mockReset().mockReturnValue(undefined)
    h.fbpFromRequest.mockReset().mockReturnValue(undefined)
    h.turnstileEnabled.mockReset().mockReturnValue(false)
    h.verifyTurnstileToken.mockReset().mockResolvedValue({ success: true })
    fetchMock = vi.fn().mockResolvedValue(coreOk({ email_verification_required: false, user: { email_verified: true } }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('never calls verifyTurnstileToken when Turnstile is disabled (local dev)', async () => {
    h.turnstileEnabled.mockReturnValue(false)
    const res = await POST(req({ email: 'a@b.com', password: 'longenough1', turnstileToken: '' }))
    expect(res.status).toBe(200)
    expect(h.verifyTurnstileToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalled()
  })

  it('rejects the registration, never calling core, when Turnstile verification fails', async () => {
    h.turnstileEnabled.mockReturnValue(true)
    h.verifyTurnstileToken.mockResolvedValue({ success: false, reason: 'invalid-input-response' })
    const res = await POST(req({ email: 'a@b.com', password: 'longenough1', turnstileToken: 'bad-token' }))
    const d = await res.json()
    expect(res.status).toBe(400)
    expect(d.ok).toBe(false)
    expect(d.error).toBe('verification_failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proceeds to core when Turnstile verification succeeds', async () => {
    h.turnstileEnabled.mockReturnValue(true)
    h.verifyTurnstileToken.mockResolvedValue({ success: true })
    const res = await POST(req({ email: 'a@b.com', password: 'longenough1', turnstileToken: 'real-token' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('passes the submitted token and the real forwarded IP to verifyTurnstileToken', async () => {
    h.turnstileEnabled.mockReturnValue(true)
    h.verifyTurnstileToken.mockResolvedValue({ success: true })
    await POST(req({ email: 'a@b.com', password: 'longenough1', turnstileToken: 'tok-xyz' }, '', '9.8.7.6'))
    expect(h.verifyTurnstileToken).toHaveBeenCalledWith('tok-xyz', '9.8.7.6')
  })

  it('treats a missing turnstileToken as null, not an empty-string pass-through', async () => {
    h.turnstileEnabled.mockReturnValue(true)
    h.verifyTurnstileToken.mockResolvedValue({ success: false, reason: 'missing_token' })
    const res = await POST(req({ email: 'a@b.com', password: 'longenough1' }))
    expect(res.status).toBe(400)
    expect(h.verifyTurnstileToken).toHaveBeenCalledWith(null, '1.2.3.4')
  })

  it('still rejects invalid email / weak password before Turnstile is even checked', async () => {
    h.turnstileEnabled.mockReturnValue(true)
    const res = await POST(req({ email: 'nope', password: 'longenough1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_email')
    expect(h.verifyTurnstileToken).not.toHaveBeenCalled()
  })

  it('does not gate non-register actions (resend) on Turnstile', async () => {
    h.turnstileEnabled.mockReturnValue(true)
    fetchMock.mockResolvedValue(coreOk({}, 200))
    const res = await POST(req({ action: 'resend', email: 'a@b.com' }))
    expect(res.status).toBe(200)
    expect(h.verifyTurnstileToken).not.toHaveBeenCalled()
  })
})
