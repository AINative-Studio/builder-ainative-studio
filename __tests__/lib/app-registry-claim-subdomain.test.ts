import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (mirrors app-registry-byo-domain.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { claimSubdomain } from '@/lib/build/app-registry'

/**
 * #78 — claimSubdomain is the PAID-gated action behind the "claim your subdomain"
 * button. It sets subdomainClaimed=true ONLY when the company is registered AND on a
 * paid plan, and is idempotent. Fetch is mocked so no real ZeroDB call is made.
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

describe('claimSubdomain (#78)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('refuses (not_registered) when the slug is not registered — no write', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const res = await claimSubdomain('ghost')
    expect(res).toEqual({ ok: false, claimed: false, reason: 'not_registered' })
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('refuses (not_paid) for an unpaid company — no write', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'quad', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    const res = await claimSubdomain('quad')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('not_paid')
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('claims for a paid company — writes subdomainClaimed=true', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', plan: 'pro', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const res = await claimSubdomain('acme')
    expect(res).toEqual({ ok: true, claimed: true, reason: undefined })
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.subdomainClaimed).toBe(true)
    expect(body.row_data.subdomainClaimedAt).toBeTruthy()
    expect(body.row_data.plan).toBe('pro') // preserves existing fields
  })

  it('is idempotent — already claimed is a no-op success (no new row)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', plan: 'business',
        subdomainClaimed: true, subdomainClaimedAt: '2026-08-02T00:00:00Z',
        createdAt: '2026-08-01T00:00:00Z',
      }]),
    )
    const res = await claimSubdomain('acme')
    expect(res).toEqual({ ok: true, claimed: true })
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })
})
