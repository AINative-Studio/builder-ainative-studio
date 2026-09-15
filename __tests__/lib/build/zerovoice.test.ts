import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  provisionZeroVoiceNumber,
  zeroVoiceProvisionEnabled,
  sendZeroVoiceSms,
  makeZeroVoiceCall,
} from '@/lib/build/zerovoice'

/**
 * lib/build/zerovoice — ZeroVoice provisioning client (#415).
 * Covers: no-JWT guard, the idempotency guard (existing number short-
 * circuits before ever calling search/purchase), the real search→purchase
 * flow, error shapes, and the cost-safety env gate. All fetch calls are
 * mocked — no real number is ever purchased by these tests.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object; text?: string }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ?? {}),
      text: async () => (r.text ?? JSON.stringify(r.json ?? {})),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('zeroVoiceProvisionEnabled (#415 cost-safety gate)', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('is false by default (env unset)', () => {
    delete process.env.ZEROVOICE_PROVISION_ENABLED
    expect(zeroVoiceProvisionEnabled()).toBe(false)
  })

  it('is false for any value other than the literal string "true"', () => {
    process.env.ZEROVOICE_PROVISION_ENABLED = '1'
    expect(zeroVoiceProvisionEnabled()).toBe(false)
  })

  it('is true only when explicitly set to "true"', () => {
    process.env.ZEROVOICE_PROVISION_ENABLED = 'true'
    expect(zeroVoiceProvisionEnabled()).toBe(true)
  })
})

describe('provisionZeroVoiceNumber (#415)', () => {
  it('returns { ok: false, reason: "no_jwt" } immediately when jwt is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await provisionZeroVoiceNumber('', 'my-co')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_jwt')
    expect(fn).not.toHaveBeenCalled()
  })

  it('IDEMPOTENCY: returns the existing number without calling search/purchase', async () => {
    const fn = mockFetch((url) => {
      if (url.includes('/numbers/list')) {
        return { ok: true, json: { items: [{ id: 'num-existing', e164: '+15551234567', status: 'active' }], page: 1, limit: 1, total: 1 } }
      }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    expect(result).toEqual({ ok: true, numberId: 'num-existing', e164: '+15551234567' })
    // Only the list check — never search, never purchase.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('searches then purchases when no existing number is found', async () => {
    const fn = mockFetch((url) => {
      if (url.includes('/numbers/list')) {
        return { ok: true, json: { items: [], page: 1, limit: 1, total: 0 } }
      }
      if (url.includes('/numbers/search')) {
        return { ok: true, json: { available_numbers: [{ phone_number: '+15559876543', friendly_name: 'x' }], total_count: 1 } }
      }
      if (url.includes('/numbers/purchase')) {
        return { ok: true, status: 201, json: { number: { id: 'num-new', e164: '+15559876543', status: 'active' }, message: 'Phone number purchased successfully' } }
      }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co', 'US', 'local')
    expect(result).toEqual({ ok: true, numberId: 'num-new', e164: '+15559876543', status: 201 })
    expect(fn).toHaveBeenCalledTimes(3)

    // Purchase call sends the exact phone_number search returned.
    const purchaseCall = fn.mock.calls.find((c) => String(c[0]).includes('/numbers/purchase'))!
    const purchaseBody = JSON.parse((purchaseCall[1] as RequestInit).body as string)
    expect(purchaseBody.phone_number).toBe('+15559876543')
    expect(purchaseBody.friendly_name).toBe('my-co')

    // Search call sends the real request shape (country/number_type, not the
    // issue's originally-assumed country_code/type field names).
    const searchCall = fn.mock.calls.find((c) => String(c[0]).includes('/numbers/search'))!
    const searchBody = JSON.parse((searchCall[1] as RequestInit).body as string)
    expect(searchBody.country).toBe('US')
    expect(searchBody.number_type).toBe('local')
  })

  it('returns { ok: false, reason: "no_available_numbers" } when search finds nothing', async () => {
    mockFetch((url) => {
      if (url.includes('/numbers/list')) return { ok: true, json: { items: [] } }
      if (url.includes('/numbers/search')) return { ok: true, json: { available_numbers: [], total_count: 0 } }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    expect(result).toEqual({ ok: false, reason: 'no_available_numbers' })
  })

  it('reports the REAL failure reason (not a fabricated "no_available_numbers") when the search itself fails with a real error', async () => {
    // Real bug found live (2026-09-14, ZeroVoice#612): a genuine 401 from
    // ZeroVoice's own auth layer was being silently reported to founders as
    // "no available numbers," masking a real, fixable auth/infra failure as
    // if it were an honest empty inventory result.
    mockFetch((url) => {
      if (url.includes('/numbers/list')) return { ok: true, json: { items: [] } }
      if (url.includes('/numbers/search')) return { ok: false, status: 401, text: '{"error":"Could not validate credentials"}' }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('search_failed_401')
    expect(result.reason).not.toBe('no_available_numbers')
  })

  it('returns { ok: false } with the real reason on a purchase failure', async () => {
    mockFetch((url) => {
      if (url.includes('/numbers/list')) return { ok: true, json: { items: [] } }
      if (url.includes('/numbers/search')) return { ok: true, json: { available_numbers: [{ phone_number: '+15551112222' }] } }
      if (url.includes('/numbers/purchase')) return { ok: false, status: 402, json: { message: 'Insufficient account balance' } }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(402)
    expect(result.reason).toContain('Insufficient account balance')
  })

  it('returns { ok: false, reason: "purchase_response_missing_number" } on a malformed success response', async () => {
    mockFetch((url) => {
      if (url.includes('/numbers/list')) return { ok: true, json: { items: [] } }
      if (url.includes('/numbers/search')) return { ok: true, json: { available_numbers: [{ phone_number: '+15551112222' }] } }
      if (url.includes('/numbers/purchase')) return { ok: true, json: { message: 'ok but no number field' } }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    expect(result).toEqual({ ok: false, reason: 'purchase_response_missing_number' })
  })

  it('treats a failed list check as "no existing number" and proceeds to search (never blocks on a transient list hiccup)', async () => {
    const fn = mockFetch((url) => {
      if (url.includes('/numbers/list')) return { ok: false, status: 500 }
      if (url.includes('/numbers/search')) return { ok: true, json: { available_numbers: [{ phone_number: '+15550009999' }] } }
      if (url.includes('/numbers/purchase')) return { ok: true, json: { number: { id: 'num-x', e164: '+15550009999' } } }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    expect(result.ok).toBe(true)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('never throws when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    // Network failure on the list check degrades to "no existing", then the
    // search call also throws -> no_available_numbers (never a crash).
    expect(result.ok).toBe(false)
  })

  it('truncates reason to 160 chars for extremely long error messages', async () => {
    const longMessage = 'x'.repeat(300)
    mockFetch((url) => {
      if (url.includes('/numbers/list')) return { ok: true, json: { items: [] } }
      if (url.includes('/numbers/search')) return { ok: true, json: { available_numbers: [{ phone_number: '+15550001111' }] } }
      if (url.includes('/numbers/purchase')) return { ok: false, status: 500, json: { message: longMessage } }
      throw new Error(`unexpected call: ${url}`)
    })
    const result = await provisionZeroVoiceNumber('jwt', 'my-co')
    expect(result.ok).toBe(false)
    expect((result.reason ?? '').length).toBeLessThanOrEqual(160)
  })
})

describe('sendZeroVoiceSms (#733)', () => {
  it('returns { ok: false, reason: "no_jwt" } when jwt is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await sendZeroVoiceSms('', '+15550001111', '+15550002222', 'hi')
    expect(result).toEqual({ ok: false, reason: 'no_jwt' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_from_number" } when fromE164 is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await sendZeroVoiceSms('jwt', '', '+15550002222', 'hi')
    expect(result).toEqual({ ok: false, reason: 'no_from_number' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_to_number" } when toE164 is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await sendZeroVoiceSms('jwt', '+15550001111', '', 'hi')
    expect(result).toEqual({ ok: false, reason: 'no_to_number' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "empty_body" } when body is blank', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await sendZeroVoiceSms('jwt', '+15550001111', '+15550002222', '   ')
    expect(result).toEqual({ ok: false, reason: 'empty_body' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('sends the real request shape and returns the sid on success', async () => {
    const fn = mockFetch((url) => {
      expect(url).toContain('/sms/send')
      return { ok: true, status: 201, json: { sid: 'SMxxxx', status: 'queued' } }
    })
    const result = await sendZeroVoiceSms('jwt', '+15550001111', '+15550002222', 'hello there')
    expect(result).toEqual({ ok: true, sid: 'SMxxxx', status: 201 })
    const call = fn.mock.calls[0]
    const sentBody = JSON.parse((call[1] as RequestInit).body as string)
    expect(sentBody).toEqual({ from_number: '+15550001111', to_number: '+15550002222', body: 'hello there' })
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt' })
  })

  it('falls back to id or message_sid when sid is absent', async () => {
    mockFetch(() => ({ ok: true, json: { id: 'msg-123' } }))
    const result = await sendZeroVoiceSms('jwt', '+15550001111', '+15550002222', 'hi')
    expect(result).toEqual({ ok: true, sid: 'msg-123', status: 200 })
  })

  it('returns the real failure reason on a non-2xx response', async () => {
    mockFetch(() => ({ ok: false, status: 400, json: { message: 'Invalid from_number' } }))
    const result = await sendZeroVoiceSms('jwt', '+15550001111', '+15550002222', 'hi')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.reason).toContain('Invalid from_number')
  })

  it('returns { ok: false, reason: "send_response_missing_sid" } on a malformed success response', async () => {
    mockFetch(() => ({ ok: true, json: { message: 'ok but no sid' } }))
    const result = await sendZeroVoiceSms('jwt', '+15550001111', '+15550002222', 'hi')
    expect(result).toEqual({ ok: false, reason: 'send_response_missing_sid', status: 200 })
  })

  it('never throws when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await sendZeroVoiceSms('jwt', '+15550001111', '+15550002222', 'hi')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })
})

describe('makeZeroVoiceCall (#733)', () => {
  it('returns { ok: false, reason: "no_jwt" } when jwt is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await makeZeroVoiceCall('', '+15550001111', '+15550002222')
    expect(result).toEqual({ ok: false, reason: 'no_jwt' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_from_number" } when fromE164 is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await makeZeroVoiceCall('jwt', '', '+15550002222')
    expect(result).toEqual({ ok: false, reason: 'no_from_number' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_to_number" } when toE164 is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await makeZeroVoiceCall('jwt', '+15550001111', '')
    expect(result).toEqual({ ok: false, reason: 'no_to_number' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('sends the real request shape and returns the callId on success', async () => {
    const fn = mockFetch((url) => {
      expect(url).toContain('/calls/outbound')
      return {
        ok: true,
        status: 201,
        json: { id: 'CAxxxx', from_number: '+15550001111', to_number: '+15550002222', direction: 'outbound', status: 'queued' },
      }
    })
    const result = await makeZeroVoiceCall('jwt', '+15550001111', '+15550002222')
    expect(result).toEqual({ ok: true, callId: 'CAxxxx', status: 201 })
    const call = fn.mock.calls[0]
    const sentBody = JSON.parse((call[1] as RequestInit).body as string)
    expect(sentBody).toEqual({ from_number: '+15550001111', to_number: '+15550002222' })
  })

  it('passes record:true through when requested', async () => {
    const fn = mockFetch(() => ({ ok: true, json: { id: 'CAxxxx' } }))
    await makeZeroVoiceCall('jwt', '+15550001111', '+15550002222', { record: true })
    const call = fn.mock.calls[0]
    const sentBody = JSON.parse((call[1] as RequestInit).body as string)
    expect(sentBody.record).toBe(true)
  })

  it('omits record from the body when not requested', async () => {
    const fn = mockFetch(() => ({ ok: true, json: { id: 'CAxxxx' } }))
    await makeZeroVoiceCall('jwt', '+15550001111', '+15550002222')
    const call = fn.mock.calls[0]
    const sentBody = JSON.parse((call[1] as RequestInit).body as string)
    expect(sentBody).not.toHaveProperty('record')
  })

  it('returns the real failure reason on a non-2xx response', async () => {
    mockFetch(() => ({ ok: false, status: 402, json: { message: 'Insufficient account balance' } }))
    const result = await makeZeroVoiceCall('jwt', '+15550001111', '+15550002222')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(402)
    expect(result.reason).toContain('Insufficient account balance')
  })

  it('returns { ok: false, reason: "call_response_missing_id" } on a malformed success response', async () => {
    mockFetch(() => ({ ok: true, json: { message: 'ok but no id' } }))
    const result = await makeZeroVoiceCall('jwt', '+15550001111', '+15550002222')
    expect(result).toEqual({ ok: false, reason: 'call_response_missing_id', status: 200 })
  })

  it('never throws when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await makeZeroVoiceCall('jwt', '+15550001111', '+15550002222')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })
})
