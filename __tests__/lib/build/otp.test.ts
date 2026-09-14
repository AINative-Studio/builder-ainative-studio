import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// otp.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), same pattern as
// app-registry.ts — must be set BEFORE the import executes. vi.hoisted() runs
// above imports.
vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

import {
  toE164,
  sendOtp,
  verifyOtp,
  zeroVoiceOtpEnabled,
  checkOtpRateLimit,
  __resetOtpRateLimitForTests,
} from '@/lib/build/otp'

/**
 * lib/build/otp (#734) — registration-time phone OTP. Covers: E.164
 * normalization, the honest not_configured gap when ZEROVOICE_OTP_ENABLED
 * is unset (the default — no Builder-owned ZeroVoice service credential
 * exists today), the real send path when explicitly enabled + credentialed,
 * verify success/mismatch/expiry/single-use, and per-phone/per-IP rate
 * limiting. All ZeroDB + ZeroVoice HTTP calls are mocked — no real SMS is
 * ever sent by these tests.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object; text?: string }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ?? {}),
      text: async () => (r.text ?? JSON.stringify(r.json ?? [])),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

// Only ZEROVOICE_* env vars are safe to vary per-test — ZERODB_API_KEY/
// ZERODB_PROJECT_ID are captured once at module load (see vi.hoisted above)
// and cannot be changed afterward, matching app-registry.ts's real behavior.
const savedZvEnv = {
  ZEROVOICE_OTP_ENABLED: process.env.ZEROVOICE_OTP_ENABLED,
  ZEROVOICE_SERVICE_JWT: process.env.ZEROVOICE_SERVICE_JWT,
  ZEROVOICE_POOL_E164: process.env.ZEROVOICE_POOL_E164,
}

beforeEach(() => {
  delete process.env.ZEROVOICE_OTP_ENABLED
  delete process.env.ZEROVOICE_SERVICE_JWT
  delete process.env.ZEROVOICE_POOL_E164
  __resetOtpRateLimitForTests()
})

afterEach(() => {
  if (savedZvEnv.ZEROVOICE_OTP_ENABLED === undefined) delete process.env.ZEROVOICE_OTP_ENABLED
  else process.env.ZEROVOICE_OTP_ENABLED = savedZvEnv.ZEROVOICE_OTP_ENABLED
  if (savedZvEnv.ZEROVOICE_SERVICE_JWT === undefined) delete process.env.ZEROVOICE_SERVICE_JWT
  else process.env.ZEROVOICE_SERVICE_JWT = savedZvEnv.ZEROVOICE_SERVICE_JWT
  if (savedZvEnv.ZEROVOICE_POOL_E164 === undefined) delete process.env.ZEROVOICE_POOL_E164
  else process.env.ZEROVOICE_POOL_E164 = savedZvEnv.ZEROVOICE_POOL_E164
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('toE164', () => {
  it('normalizes a bare 10-digit US number', () => {
    expect(toE164('5550001111')).toBe('+15550001111')
  })
  it('normalizes a formatted US number', () => {
    expect(toE164('(555) 000-1111')).toBe('+15550001111')
  })
  it('normalizes an 11-digit number starting with 1', () => {
    expect(toE164('15550001111')).toBe('+15550001111')
  })
  it('passes through an already-E.164 number', () => {
    expect(toE164('+447700900123')).toBe('+447700900123')
  })
  it('returns null for empty input', () => {
    expect(toE164('')).toBeNull()
    expect(toE164('   ')).toBeNull()
  })
  it('returns null for a too-short number', () => {
    expect(toE164('123')).toBeNull()
  })
  it('returns null for a too-long number', () => {
    expect(toE164('1'.repeat(20))).toBeNull()
  })
})

describe('zeroVoiceOtpEnabled (honest infra gate)', () => {
  it('is false by default (env unset)', () => {
    delete process.env.ZEROVOICE_OTP_ENABLED
    expect(zeroVoiceOtpEnabled()).toBe(false)
  })
  it('is false for any value other than the literal string "true"', () => {
    process.env.ZEROVOICE_OTP_ENABLED = '1'
    expect(zeroVoiceOtpEnabled()).toBe(false)
  })
  it('is true only when explicitly set to "true"', () => {
    process.env.ZEROVOICE_OTP_ENABLED = 'true'
    expect(zeroVoiceOtpEnabled()).toBe(true)
  })
})

describe('sendOtp — the honest not_configured path (default env)', () => {
  it('stores a real code but returns not_configured when ZEROVOICE_OTP_ENABLED is unset', async () => {
    delete process.env.ZEROVOICE_OTP_ENABLED
    const fn = mockFetch((url) => {
      expect(url).toContain('builder_otp_codes')
      return { ok: true, json: {} }
    })
    const result = await sendOtp('+15550001111')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_configured')
    expect(result.expiresAt).toBeTruthy()
    // The code WAS stored (real POSTs to the otp table happened) — this is
    // real logic, not a stub; only the external SMS call is skipped. Two
    // calls: an idempotent ensure-table create, then the actual row insert
    // (see ensureOtpTable — a brand-new table 404s on first write otherwise,
    // the same class of bug this codebase already hit on build_documents).
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('returns invalid_phone for an empty phone', async () => {
    const result = await sendOtp('')
    expect(result).toEqual({ ok: false, reason: 'invalid_phone' })
  })

  it('returns storage_failed when the ZeroDB write fails', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const result = await sendOtp('+15550001111')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('storage_failed')
  })
})

describe('sendOtp — real send path when explicitly enabled + credentialed', () => {
  it('sends via ZeroVoice and returns ok:true when the service credential is configured', async () => {
    process.env.ZEROVOICE_OTP_ENABLED = 'true'
    process.env.ZEROVOICE_SERVICE_JWT = 'service-jwt'
    process.env.ZEROVOICE_POOL_E164 = '+15005550006'
    const fn = mockFetch((url) => {
      if (url.includes('builder_otp_codes')) return { ok: true, json: {} }
      if (url.includes('/sms/send')) return { ok: true, status: 202, json: { sid: 'SMxxx' } }
      return { ok: false }
    })
    const result = await sendOtp('+15550001111')
    expect(result.ok).toBe(true)
    expect(result.expiresAt).toBeTruthy()
    const smsCall = fn.mock.calls.find((c) => String(c[0]).includes('/sms/send'))
    expect(smsCall).toBeTruthy()
    const sentBody = JSON.parse((smsCall![1] as RequestInit).body as string)
    expect(sentBody.to_number).toBe('+15550001111')
    expect(sentBody.from_number).toBe('+15005550006')
    expect(sentBody.body).toContain('verification code')
  })

  it('still returns not_configured when enabled but no service credential is set', async () => {
    process.env.ZEROVOICE_OTP_ENABLED = 'true'
    delete process.env.ZEROVOICE_SERVICE_JWT
    delete process.env.ZEROVOICE_POOL_E164
    mockFetch((url) => (url.includes('builder_otp_codes') ? { ok: true, json: {} } : { ok: false }))
    const result = await sendOtp('+15550001111')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_configured')
  })

  it('surfaces a real ZeroVoice send failure as send_failed', async () => {
    process.env.ZEROVOICE_OTP_ENABLED = 'true'
    process.env.ZEROVOICE_SERVICE_JWT = 'service-jwt'
    process.env.ZEROVOICE_POOL_E164 = '+15005550006'
    mockFetch((url) => {
      if (url.includes('builder_otp_codes')) return { ok: true, json: {} }
      if (url.includes('/sms/send')) return { ok: false, status: 500, json: { message: 'twilio down' } }
      return { ok: false }
    })
    const result = await sendOtp('+15550001111')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('twilio down')
  })
})

describe('verifyOtp', () => {
  function rowsResponse(rows: Array<Record<string, unknown>>) {
    return { ok: true, json: rows.map((row_data) => ({ row_data })) }
  }

  it('returns invalid_request for missing phone/code', async () => {
    expect(await verifyOtp('', '123456')).toEqual({ ok: false, reason: 'invalid_request' })
    expect(await verifyOtp('+15550001111', '')).toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('returns no_code_sent when there is no stored row for this phone', async () => {
    mockFetch(() => rowsResponse([]))
    const result = await verifyOtp('+15550001111', '123456')
    expect(result).toEqual({ ok: false, reason: 'no_code_sent' })
  })

  it('verifies a correct, unexpired, unused code', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    mockFetch((url) => {
      if (url.includes('builder_otp_codes') && !url.includes('rows?')) return { ok: true, json: {} }
      return rowsResponse([{ phone: '+15550001111', code: '123456', expiresAt: future, createdAt: new Date().toISOString() }])
    })
    const result = await verifyOtp('+15550001111', '123456')
    expect(result).toEqual({ ok: true })
  })

  it('rejects a mismatched code', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    mockFetch(() => rowsResponse([{ phone: '+15550001111', code: '123456', expiresAt: future, createdAt: new Date().toISOString() }]))
    const result = await verifyOtp('+15550001111', '999999')
    expect(result).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects an expired code', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    mockFetch(() => rowsResponse([{ phone: '+15550001111', code: '123456', expiresAt: past, createdAt: new Date().toISOString() }]))
    const result = await verifyOtp('+15550001111', '123456')
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a code already consumed (single-use)', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    mockFetch(() => rowsResponse([{
      phone: '+15550001111', code: '123456', expiresAt: future,
      createdAt: new Date().toISOString(), consumedAt: new Date().toISOString(),
    }]))
    const result = await verifyOtp('+15550001111', '123456')
    expect(result).toEqual({ ok: false, reason: 'already_used' })
  })

  it('picks the most recently created row when multiple exist', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const older = { phone: '+15550001111', code: '111111', expiresAt: future, createdAt: '2026-01-01T00:00:00.000Z' }
    const newer = { phone: '+15550001111', code: '222222', expiresAt: future, createdAt: '2026-01-02T00:00:00.000Z' }
    mockFetch(() => rowsResponse([older, newer]))
    const result = await verifyOtp('+15550001111', '222222')
    expect(result).toEqual({ ok: true })
  })
})

describe('checkOtpRateLimit', () => {
  it('allows sends under the per-phone limit', () => {
    expect(checkOtpRateLimit('+15550001111', '1.2.3.4').ok).toBe(true)
    expect(checkOtpRateLimit('+15550001111', '1.2.3.4').ok).toBe(true)
    expect(checkOtpRateLimit('+15550001111', '1.2.3.4').ok).toBe(true)
  })

  it('rejects a 4th send within the hour for the same phone', () => {
    checkOtpRateLimit('+15550001111', '1.2.3.4')
    checkOtpRateLimit('+15550001111', '1.2.3.5')
    checkOtpRateLimit('+15550001111', '1.2.3.6')
    const fourth = checkOtpRateLimit('+15550001111', '1.2.3.7')
    expect(fourth).toEqual({ ok: false, reason: 'rate_limited_phone' })
  })

  it('rejects excessive sends from the same IP across different phones', () => {
    for (let i = 0; i < 10; i++) {
      checkOtpRateLimit(`+1555000${1000 + i}`, '9.9.9.9')
    }
    const eleventh = checkOtpRateLimit('+15550009999', '9.9.9.9')
    expect(eleventh).toEqual({ ok: false, reason: 'rate_limited_ip' })
  })
})
