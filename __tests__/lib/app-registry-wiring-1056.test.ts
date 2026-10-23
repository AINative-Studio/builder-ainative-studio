import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppWiring } from '@/lib/build/app-registry'
import { __resetRegistryCacheForTests } from '@/lib/build/app-registry'

/**
 * #1056 — setAppWiring persists the `*Wired` flags computed by a fresh scan
 * of the generated app's source, as a signal distinct from `*Provisioned`
 * (credential issuance). Same idempotent-no-op-on-unchanged shape as the
 * registry's other setters (setAppCommsMode etc.) — mirrors real production
 * evidence: mendr was provisioned (6 primitives) but wired nothing; this
 * setter is what would have recorded that honestly.
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

describe('setAppWiring (#1056)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); __resetRegistryCacheForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('no-op (false) when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppWiring('ghost', { zeroinvoiceWired: true })
    expect(ok).toBe(false)
  })

  it('records all-false wiring for a provisioned-but-unwired company (the real mendr shape)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'mendr', chatId: 'chat-mendr', createdAt: '2026-09-01T00:00:00Z',
        zeroinvoiceProvisioned: true, zerocrmProvisioned: true, capstackProvisioned: true,
        serviceosProvisioned: true, socialgraphProvisioned: true, livestreamingProvisioned: true,
      }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppWiring('mendr', {
      zeroinvoiceWired: false, zerocrmWired: false, capstackWired: false,
      serviceosWired: false, socialgraphWired: false, livestreamingWired: false,
    })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.zeroinvoiceWired).toBe(false)
    // The provisioned flags must be carried forward untouched — additive only.
    expect(body.row_data.zeroinvoiceProvisioned).toBe(true)
    expect(body.row_data.wiringScannedAt).toBeDefined()
  })

  it('records true for a genuinely wired primitive (the real habanero-hub/flashpoint shape)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'habanero-hub', chatId: 'chat-hh', createdAt: '2026-09-01T00:00:00Z', pipelineProvisioned: true }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppWiring('habanero-hub', { pipelineWired: true, zerovoiceWired: true })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.pipelineWired).toBe(true)
    expect(body.row_data.zerovoiceWired).toBe(true)
  })

  it('is idempotent — re-scanning with the SAME result writes no new row', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z',
        zeroinvoiceWired: true, wiringScannedAt: '2026-08-02T00:00:00Z',
      }]),
    )
    const ok = await setAppWiring('acme', { zeroinvoiceWired: true })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('writes a new row when the wiring result actually changed (e.g. a regen newly wires a primitive)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z',
        zeroinvoiceWired: false, wiringScannedAt: '2026-08-02T00:00:00Z',
      }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppWiring('acme', { zeroinvoiceWired: true })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
  })
})
