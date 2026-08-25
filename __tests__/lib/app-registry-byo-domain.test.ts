import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppByoDomain } from '@/lib/build/app-registry'

/**
 * #53 — setAppByoDomain persists a founder's CONNECTED (bring-your-own) domain and is
 * idempotent: re-writing the SAME domain + id + status is a no-op (returns true, no
 * POST) so repeated status polls never append churn rows. Fetch is mocked so no real
 * ZeroDB call is made.
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

describe('setAppByoDomain (#53)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('no-op (false) when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppByoDomain('ghost', { domain: 'myco.com' })
    expect(ok).toBe(false)
  })

  it('no-op (false) when no domain provided (no fetch)', async () => {
    const ok = await setAppByoDomain('acme', { domain: '' })
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes a row carrying the connected domain, id and status', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppByoDomain('acme', { domain: 'MyCo.com', byoDomainId: 'cd-1', status: 'verifying' })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.byoDomain).toBe('myco.com') // lowercased
    expect(body.row_data.byoDomainId).toBe('cd-1')
    expect(body.row_data.byoDomainStatus).toBe('verifying')
    expect(body.row_data.byoDomainConnectedAt).toBeTruthy()
  })

  it('is idempotent — same domain + id + status writes NO new row', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z',
        byoDomain: 'myco.com', byoDomainId: 'cd-1', byoDomainStatus: 'live',
      }]),
    )
    const ok = await setAppByoDomain('acme', { domain: 'myco.com', byoDomainId: 'cd-1', status: 'live' })
    expect(ok).toBe(true)
    // No POST — nothing changed.
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('writes a new row when the status advances (pending → verifying)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z',
        byoDomain: 'myco.com', byoDomainId: 'cd-1', byoDomainStatus: 'pending',
      }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppByoDomain('acme', { domain: 'myco.com', byoDomainId: 'cd-1', status: 'verifying' })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.byoDomainStatus).toBe('verifying')
  })
})
