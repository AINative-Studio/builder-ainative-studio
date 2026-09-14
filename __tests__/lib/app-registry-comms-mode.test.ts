import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppCommsMode, setAppLastDigestAt } from '@/lib/build/app-registry'

/**
 * #743 — setAppCommsMode persists the founder's chosen comms cadence mode
 * ('agile' | 'pairProgramming'), and setAppLastDigestAt advances the
 * pair-programming digest delta marker. Both follow setAppZeroVoice's
 * established shape: idempotent no-op success when nothing changed, no-op
 * (false) when the slug isn't registered. Fetch is mocked so no real ZeroDB
 * call is made.
 */
function rowsResponse(rows: any[]): Response {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

describe('setAppCommsMode (#743)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('no-op (false) when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppCommsMode('ghost', 'pairProgramming')
    expect(ok).toBe(false)
  })

  it('no-op (false) for an invalid mode value (no fetch)', async () => {
    const ok = await setAppCommsMode('acme', 'weekly' as any)
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes a row carrying the chosen mode', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppCommsMode('acme', 'pairProgramming')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.commsMode).toBe('pairProgramming')
  })

  it('is idempotent — re-selecting the current mode writes NO new row', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z', commsMode: 'pairProgramming' }]),
    )
    const ok = await setAppCommsMode('acme', 'pairProgramming')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('treats absent commsMode as agile — switching to agile explicitly is a no-op', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    const ok = await setAppCommsMode('acme', 'agile')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('writes a new row when switching modes (agile → pairProgramming)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppCommsMode('acme', 'pairProgramming')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
  })
})

describe('setAppLastDigestAt (#743)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('no-op (false) when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppLastDigestAt('ghost', '2026-09-14T15:00:00.000Z')
    expect(ok).toBe(false)
  })

  it('no-op (false) when no timestamp provided (no fetch)', async () => {
    const ok = await setAppLastDigestAt('acme', '')
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes a row carrying the new lastDigestAt', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppLastDigestAt('acme', '2026-09-14T15:00:00.000Z')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.lastDigestAt).toBe('2026-09-14T15:00:00.000Z')
  })
})
