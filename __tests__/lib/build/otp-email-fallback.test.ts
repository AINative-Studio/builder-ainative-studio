import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// otp.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const) — must be set
// before the import executes (same pattern as __tests__/lib/build/otp.test.ts).
vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

const h = vi.hoisted(() => ({ sendViaResend: vi.fn() }))
vi.mock('@/lib/build/resend-client', () => ({ sendViaResend: h.sendViaResend, resendConfigured: () => true }))

function mockFetch() {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => JSON.stringify([]),
  }) as unknown as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('sendOtpEmail', () => {
  beforeEach(() => {
    h.sendViaResend.mockReset().mockResolvedValue({ ok: true })
    mockFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a real email via the existing Resend client with a 6-digit code in the body', async () => {
    const { sendOtpEmail } = await import('@/lib/build/otp')
    const result = await sendOtpEmail('founder@example.com')
    expect(result.ok).toBe(true)
    expect(h.sendViaResend).toHaveBeenCalledTimes(1)
    const [, to, subject, html, text] = h.sendViaResend.mock.calls[0]
    expect(to).toBe('founder@example.com')
    expect(subject.toLowerCase()).toContain('verification code')
    expect(html + text).toMatch(/\b\d{6}\b/)
  })

  it('stores the code so it verifies through the SAME verifyOtp() phone-OTP uses', async () => {
    const storedRows: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/rows')) {
          const body = JSON.parse(String(init.body))
          storedRows.push(body.row_data)
          return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
        }
        if (u.includes('/rows')) {
          return {
            ok: true,
            status: 200,
            json: async () => storedRows.map((row_data) => ({ row_data })),
            text: async () => JSON.stringify(storedRows.map((row_data) => ({ row_data }))),
          } as unknown as Response
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
      }),
    )

    const { sendOtpEmail, verifyOtp } = await import('@/lib/build/otp')
    await sendOtpEmail('founder@example.com')
    const sentCode = String(h.sendViaResend.mock.calls[0][3]).match(/\b(\d{6})\b/)?.[1]
    const result = await verifyOtp('founder@example.com', sentCode as string)
    expect(result.ok).toBe(true)
  })

  it('returns ok:false with reason "invalid_email" for a malformed address, without calling Resend', async () => {
    const { sendOtpEmail } = await import('@/lib/build/otp')
    const result = await sendOtpEmail('not-an-email')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_email')
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('returns ok:false with reason "send_failed" when Resend itself fails, never throws', async () => {
    h.sendViaResend.mockResolvedValue({ ok: false, reason: 'resend_5xx' })
    const { sendOtpEmail } = await import('@/lib/build/otp')
    const result = await sendOtpEmail('founder@example.com')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('send_failed')
  })
})
