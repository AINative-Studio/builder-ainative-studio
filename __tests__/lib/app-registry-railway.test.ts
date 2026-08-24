import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes. ESM hoists `import` above top-level statements,
// so a plain assignment here would run too late — vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppRailwayService } from '@/lib/build/app-registry'

/**
 * #243 — setAppRailwayService persists a company's dedicated Railway service and is
 * idempotent: writing the SAME serviceId again is a no-op (returns true, no POST), so
 * a re-run of the verify trigger never appends a churn row. We mock global fetch to
 * observe the registry reads/writes without a real ZeroDB call.
 */
function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

describe('setAppRailwayService (#243)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('no-op (false) when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([])) // resolveApp → nothing
    const ok = await setAppRailwayService('ghost', { railwayServiceId: 'svc-1' })
    expect(ok).toBe(false)
  })

  it('no-op (false) when no serviceId is provided', async () => {
    const ok = await setAppRailwayService('acme', { railwayServiceId: '' })
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes a new row with the serviceId + real deploy URL when registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse()) // registerApp POST
    const ok = await setAppRailwayService('acme', {
      railwayServiceId: 'svc-1',
      deployUrl: 'https://acme.up.railway.app',
      domain: 'acme.up.railway.app',
    })
    expect(ok).toBe(true)
    // The POST body carries the new service id + URL.
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.railwayServiceId).toBe('svc-1')
    expect(body.row_data.deployUrl).toBe('https://acme.up.railway.app')
    expect(body.row_data.railwayDeployedAt).toBeTruthy()
  })

  it('IDEMPOTENT — same serviceId already stored → no-op success, NO write POST', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([
        { slug: 'acme', chatId: 'chat-1', railwayServiceId: 'svc-1', createdAt: '2026-08-01T00:00:00Z' },
      ]),
    )
    const ok = await setAppRailwayService('acme', { railwayServiceId: 'svc-1' })
    expect(ok).toBe(true)
    // Only the resolveApp GET happened — no POST to append a duplicate row.
    const posts = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')
    expect(posts.length).toBe(0)
  })
})
