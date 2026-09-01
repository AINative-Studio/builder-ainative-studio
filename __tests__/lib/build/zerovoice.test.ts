import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { provisionZeroVoiceNumber, zeroVoiceProvisionEnabled } from '@/lib/build/zerovoice'

/**
 * lib/build/zerovoice — ZeroVoice provisioning client (#415).
 * Covers: no-JWT guard, the idempotency guard (existing number short-
 * circuits before ever calling search/purchase), the real search→purchase
 * flow, error shapes, and the cost-safety env gate. All fetch calls are
 * mocked — no real number is ever purchased by these tests.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ?? {}),
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
