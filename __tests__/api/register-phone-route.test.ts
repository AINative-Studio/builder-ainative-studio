/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function req(body: unknown, ip = '1.2.3.4') {
  return {
    json: async () => body,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase()
        if (key === 'x-forwarded-for') return ip
        return null
      },
    },
  } as any
}

describe('POST /api/build/register-phone — send-otp action', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid phone before calling core', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ action: 'send-otp', phone: 'not-a-phone' }))
    const d = await res.json()
    expect(res.status).toBe(400)
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('invalid_phone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies a valid phone to core send-phone-otp', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ action: 'send-otp', phone: '5125551234' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/send-phone-otp'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+15125551234' }),
      }),
    )
  })

  it('surfaces a core failure as ok:false without leaking the raw core body', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ detail: 'rate limited internally' }) })
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ action: 'send-otp', phone: '5125551234' }))
    const d = await res.json()
    expect(res.status).toBe(429)
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('send_failed')
  })
})

describe('POST /api/build/register-phone — register action', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ access_token: 'tok-abc', refresh_token: 'ref-abc', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid phone before calling core', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: 'bad', otp_code: '123456' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_phone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing otp_code before calling core', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies to core register-phone and returns raw tokens on success', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(200)
    expect(d).toEqual({ ok: true, accessToken: 'tok-abc', refreshToken: 'ref-abc', expiresIn: 3600 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/register-phone'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+15125551234', otp_code: '123456' }),
      }),
    )
  })

  it('surfaces a core registration failure cleanly', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ detail: 'phone already registered' }) })
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(409)
    expect(d.ok).toBe(false)
    expect(d.error).toBe('phone already registered')
  })

  it('gates on Turnstile when enabled, failing closed before calling core', async () => {
    vi.doMock('@/lib/turnstile', () => ({
      turnstileEnabled: () => true,
      verifyTurnstileToken: vi.fn().mockResolvedValue({ success: false }),
    }))
    vi.resetModules()
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456', turnstileToken: 'bad' }))
    const d = await res.json()
    expect(res.status).toBe(400)
    expect(d.ok).toBe(false)
    expect(d.error).toBe('verification_failed')
    expect(fetchMock).not.toHaveBeenCalled()
    vi.doUnmock('@/lib/turnstile')
    vi.resetModules()
  })
})
