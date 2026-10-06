/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ sendOtpEmail: vi.fn(), verifyOtp: vi.fn() }))
vi.mock('@/lib/build/otp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/otp')>('@/lib/build/otp')
  return { ...actual, sendOtpEmail: h.sendOtpEmail, verifyOtp: h.verifyOtp }
})

import { POST } from '@/app/api/build/register/route'

function req(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as any
}

describe("POST /api/build/register — action:'send-otp-email' (#BLD-02b)", () => {
  beforeEach(() => { h.sendOtpEmail.mockReset() })

  it('calls sendOtpEmail with the submitted email and returns its result', async () => {
    h.sendOtpEmail.mockResolvedValue({ ok: true, expiresAt: '2026-10-06T00:10:00.000Z' })
    const res = await POST(req({ action: 'send-otp-email', email: 'founder@example.com' }))
    expect(res.status).toBe(200)
    expect(h.sendOtpEmail).toHaveBeenCalledWith('founder@example.com')
    expect((await res.json()).ok).toBe(true)
  })

  it('rejects a missing email before calling sendOtpEmail', async () => {
    const res = await POST(req({ action: 'send-otp-email', email: '' }))
    expect(res.status).toBe(400)
    expect(h.sendOtpEmail).not.toHaveBeenCalled()
  })
})

describe("POST /api/build/register — action:'verify-otp' with an email-sent code (#BLD-02b)", () => {
  beforeEach(() => { h.verifyOtp.mockReset() })

  it('verifies against the submitted email when no phone is given, since the code was sent to that email', async () => {
    h.verifyOtp.mockResolvedValue({ ok: true })
    const res = await POST(req({ action: 'verify-otp', email: 'founder@example.com', code: '123456' }))
    expect(h.verifyOtp).toHaveBeenCalledWith('founder@example.com', '123456')
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('still verifies against a real phone number when one is given (unchanged phone-OTP behavior)', async () => {
    h.verifyOtp.mockResolvedValue({ ok: true })
    const res = await POST(req({ action: 'verify-otp', phone: '5550001111', code: '123456' }))
    expect(h.verifyOtp).toHaveBeenCalledWith('+15550001111', '123456')
    expect(res.status).toBe(200)
  })

  it('rejects when neither a valid phone nor an email is given', async () => {
    const res = await POST(req({ action: 'verify-otp', code: '123456' }))
    expect(res.status).toBe(400)
    expect(h.verifyOtp).not.toHaveBeenCalled()
  })
})
