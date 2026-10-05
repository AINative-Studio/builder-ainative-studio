import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// sms-disambiguation.ts captures API_KEY + PROJECT_ID at MODULE LOAD
// (const), same pattern as founder-phones.ts/otp.ts/app-registry.ts — must
// be set BEFORE the import executes. vi.hoisted() runs above imports.
// (Ruling carried from Task 1: a beforeEach setting these vars has no
// effect, since the module has already read them by then.)
vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

import { setPendingDisambiguation, getPendingDisambiguation, clearPendingDisambiguation } from '@/lib/build/sms-disambiguation'

function mockFetchSequence(impl: (url: string, init?: RequestInit) => { ok: boolean; text?: string }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return { ok: r.ok, text: async () => (r.text ?? '') } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('setPendingDisambiguation', () => {
  it('writes a row and returns true on success', async () => {
    const fn = mockFetchSequence(() => ({ ok: true }))
    const result = await setPendingDisambiguation('+15550001111', [{ slug: 'acme', name: 'Acme' }])
    expect(result).toBe(true)
    expect(fn).toHaveBeenCalled()
  })

  it('returns false on a write failure, never throws', async () => {
    mockFetchSequence(() => ({ ok: false }))
    const result = await setPendingDisambiguation('+15550001111', [{ slug: 'acme', name: 'Acme' }])
    expect(result).toBe(false)
  })
})

describe('getPendingDisambiguation', () => {
  it('returns null when no row exists for this number', async () => {
    mockFetchSequence(() => ({ ok: true, text: JSON.stringify([]) }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toBeNull()
  })

  it('returns the companies list for a fresh, unexpired entry', async () => {
    const expiresAt = new Date('2026-01-01T00:08:00.000Z').toISOString() // 8 min out, within a 10-min TTL
    mockFetchSequence(() => ({
      ok: true,
      text: JSON.stringify([{
        row_data: { fromNumber: '+15550001111', companies: [{ slug: 'acme', name: 'Acme' }], expiresAt, createdAt: '2026-01-01T00:00:00.000Z' },
      }]),
    }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toEqual([{ slug: 'acme', name: 'Acme' }])
  })

  it('returns null for an EXPIRED entry, even though a row exists', async () => {
    const expiresAt = new Date('2025-12-31T23:00:00.000Z').toISOString() // in the past relative to mocked "now"
    mockFetchSequence(() => ({
      ok: true,
      text: JSON.stringify([{
        row_data: { fromNumber: '+15550001111', companies: [{ slug: 'acme', name: 'Acme' }], expiresAt, createdAt: '2025-12-31T22:50:00.000Z' },
      }]),
    }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toBeNull()
  })

  it('picks the LATEST row when multiple exist for the same number', async () => {
    const freshExpiresAt = new Date('2026-01-01T00:09:00.000Z').toISOString()
    mockFetchSequence(() => ({
      ok: true,
      text: JSON.stringify([
        { row_data: { fromNumber: '+15550001111', companies: [{ slug: 'old', name: 'Old' }], expiresAt: '2025-12-31T00:00:00.000Z', createdAt: '2025-12-31T00:00:00.000Z' } },
        { row_data: { fromNumber: '+15550001111', companies: [{ slug: 'acme', name: 'Acme' }], expiresAt: freshExpiresAt, createdAt: '2026-01-01T00:00:00.000Z' } },
      ]),
    }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toEqual([{ slug: 'acme', name: 'Acme' }])
  })

  it('never throws on a network error — returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toBeNull()
  })
})

describe('clearPendingDisambiguation', () => {
  it('writes a cleared/expired marker row and returns true on success', async () => {
    const fn = mockFetchSequence(() => ({ ok: true }))
    const result = await clearPendingDisambiguation('+15550001111')
    expect(result).toBe(true)
    expect(fn).toHaveBeenCalled()
  })
})
