import { describe, it, expect, vi, afterEach } from 'vitest'

// founder-phones.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const),
// same pattern as app-registry.ts/otp.ts — must be set BEFORE the import
// executes. vi.hoisted() runs above imports. A beforeEach setting these
// vars would have no effect: the module has already read them by then.
vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mockRows(rows: Array<{ row_data: Record<string, unknown> }>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(rows),
  }) as unknown as Response))
}

import { findFounderByPhone } from '@/lib/build/founder-phones'

describe('findFounderByPhone', () => {
  it('returns null when unconfigured', async () => {
    // configured() reads module-load-time consts — the only way to exercise
    // the unconfigured branch is a genuinely fresh module instance with the
    // env var absent BEFORE that fresh import runs.
    vi.resetModules()
    const savedKey = process.env.ZERODB_API_KEY
    delete process.env.ZERODB_API_KEY
    try {
      const fresh = await import('@/lib/build/founder-phones')
      const result = await fresh.findFounderByPhone('+15550001111')
      expect(result).toBeNull()
    } finally {
      process.env.ZERODB_API_KEY = savedKey
      vi.resetModules()
    }
  })

  it('returns null when no row matches the phone', async () => {
    mockRows([{ row_data: { email: 'a@b.com', phone: '+15559999999', verified: true, createdAt: '2026-01-01T00:00:00Z' } }])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })

  it('returns null when the matching row is unverified', async () => {
    mockRows([{ row_data: { email: 'a@b.com', phone: '+15550001111', verified: false, createdAt: '2026-01-01T00:00:00Z' } }])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })

  it('returns the email for a verified matching row', async () => {
    mockRows([{ row_data: { email: 'a@b.com', phone: '+15550001111', verified: true, createdAt: '2026-01-01T00:00:00Z' } }])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toEqual({ email: 'a@b.com' })
  })

  it('picks the LATEST verified row when multiple exist for the same phone', async () => {
    mockRows([
      { row_data: { email: 'old@b.com', phone: '+15550001111', verified: true, createdAt: '2026-01-01T00:00:00Z' } },
      { row_data: { email: 'new@b.com', phone: '+15550001111', verified: true, createdAt: '2026-02-01T00:00:00Z' } },
    ])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toEqual({ email: 'new@b.com' })
  })

  it('never throws on a network error — returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })

  it('never throws on a non-ok response — returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' }) as unknown as Response))
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })
})
