import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppCommsOptOut } from '@/lib/build/app-registry'

/**
 * #742 — setAppCommsOptOut persists a founder's "don't proactively contact me"
 * preference. Idempotent: re-writing the SAME value is a no-op (returns true,
 * no POST) so a settings-panel toggle that fires twice never appends a churn
 * row. Fetch is mocked so no real ZeroDB call is made.
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

describe('setAppCommsOptOut (#742)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('no-op (false) when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppCommsOptOut('ghost', true)
    expect(ok).toBe(false)
  })

  it('writes a row setting commsOptOut true', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppCommsOptOut('acme', true)
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.commsOptOut).toBe(true)
    expect(body.row_data.commsOptOutAt).toBeTruthy()
  })

  it('is idempotent — re-setting the same value writes NO new row', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z', commsOptOut: true,
      }]),
    )
    const ok = await setAppCommsOptOut('acme', true)
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('writes a new row when clearing the opt-out (true → false)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z', commsOptOut: true,
      }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppCommsOptOut('acme', false)
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.commsOptOut).toBe(false)
  })

  it('treats absent commsOptOut as false when re-setting to false (idempotent)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    const ok = await setAppCommsOptOut('acme', false)
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })
})
