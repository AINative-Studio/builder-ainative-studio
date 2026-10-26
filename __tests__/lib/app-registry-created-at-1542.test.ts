import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { registerApp } from '@/lib/build/app-registry'

/**
 * #1542 (side-finding, confirmed and fixed alongside the real fabricated-
 * history bug): registerApp() previously stamped `createdAt: new
 * Date().toISOString()` UNCONDITIONALLY on every call, including every edit
 * of an already-registered company — so the registry's own `createdAt` drifted
 * forward to "now" on every write rather than preserving the real original
 * creation time. Every setApp* caller updating an existing entry already
 * spreads `...existing` (which carries the real original createdAt) into the
 * call; the fix only stamps "now" when the caller didn't supply a createdAt
 * at all — a genuinely new registration.
 */
function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>): any {
  const [, init] = fetchMock.mock.calls.at(-1)!
  return JSON.parse(init.body)
}

describe('registerApp — createdAt preservation (#1542)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('stamps a fresh createdAt when none is supplied (genuinely new registration)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(okResponse())

    const before = Date.now()
    const ok = await registerApp({ slug: 'newco', chatId: 'chat-1' })
    expect(ok).toBe(true)

    const body = lastFetchBody(fetchMock)
    expect(body.row_data.createdAt).toBeTruthy()
    expect(Date.parse(body.row_data.createdAt)).toBeGreaterThanOrEqual(before)
  })

  it('preserves a caller-supplied createdAt instead of overwriting it with "now" (the real bug)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(okResponse())

    const realOriginalCreatedAt = '2026-01-05T10:00:00.000Z'
    const ok = await registerApp({
      slug: 'ember-box',
      chatId: 'chat-2',
      createdAt: realOriginalCreatedAt,
      // Simulates a setApp* caller editing an existing entry — it spreads
      // ...existing (carrying the real createdAt) plus the one changed field.
      color: '#0000ff',
    } as any)
    expect(ok).toBe(true)

    const body = lastFetchBody(fetchMock)
    expect(body.row_data.createdAt).toBe(realOriginalCreatedAt)
  })

  it('never emits a top-level `createdAt` key alongside the rest of the row twice (no duplicate/undefined leak)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(okResponse())

    await registerApp({ slug: 'acme', chatId: 'chat-3', createdAt: '2026-02-01T00:00:00.000Z', name: 'Acme' } as any)

    const body = lastFetchBody(fetchMock)
    expect(body.row_data.slug).toBe('acme')
    expect(body.row_data.name).toBe('Acme')
    expect(Object.keys(body.row_data).filter((k) => k === 'createdAt')).toHaveLength(1)
  })
})
