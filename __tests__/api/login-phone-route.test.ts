/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/login-phone', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid phone before calling core', async () => {
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: 'bad', otp_code: '123456' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_phone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing otp_code before calling core', async () => {
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies to core login-phone and returns raw tokens on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok-xyz', refresh_token: 'ref-xyz', expires_in: 3600 }),
    })
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(200)
    expect(d).toEqual({ ok: true, accessToken: 'tok-xyz', refreshToken: 'ref-xyz', expiresIn: 3600 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/login-phone'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+15125551234', otp_code: '123456' }),
      }),
    )
  })

  it('surfaces a 404 from core as a distinct NO_SUCH_PHONE_ACCOUNT errorCode', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: 'no account found' }) })
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(404)
    expect(d.ok).toBe(false)
    expect(d.errorCode).toBe('NO_SUCH_PHONE_ACCOUNT')
  })

  it('surfaces any other core failure without the special errorCode', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'invalid otp' }) })
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '000000' }))
    const d = await res.json()
    expect(res.status).toBe(400)
    expect(d.ok).toBe(false)
    expect(d.errorCode).toBeUndefined()
    expect(d.error).toBe('invalid otp')
  })
})
