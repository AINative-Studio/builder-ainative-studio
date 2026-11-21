import { describe, it, expect, vi, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { listRegistryEntriesMissingChatId, __resetRegistryCacheForTests } from '@/lib/build/app-registry'

/**
 * #2156 — listRegistryEntriesMissingChatId() is the sibling read to
 * listAllAppsWithStatus() for the one cohort that function structurally
 * excludes: registry rows with NO chatId at all (e.g. "flo", confirmed live
 * with chatId: null and 24+ days of nightly-loop enrollment burning cycles
 * on a company with nothing to maintain).
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function failResponse(status = 500): Response {
  return { ok: false, status, text: async () => '{"detail":"error"}' } as unknown as Response
}
function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('listRegistryEntriesMissingChatId (#2156)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); __resetRegistryCacheForTests() })

  it('returns only rows with no chatId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rowsResponse([
      row('acme'),
      row('flo', { chatId: null }),
      row('ghost', { chatId: '' }),
    ])))

    const { apps, ok } = await listRegistryEntriesMissingChatId()
    expect(ok).toBe(true)
    expect(apps.map((a) => a.slug).sort()).toEqual(['flo', 'ghost'])
  })

  it('excludes a slug whose MOST RECENT row already has a real chatId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rowsResponse([
      row('flo', { chatId: null, createdAt: '2026-08-01T00:00:00Z' }),
      row('flo', { chatId: 'chat-flo-later', createdAt: '2026-09-01T00:00:00Z' }),
    ])))

    const { apps, ok } = await listRegistryEntriesMissingChatId()
    expect(ok).toBe(true)
    expect(apps).toEqual([])
  })

  it('includes a slug whose most recent row LOST its chatId after an earlier one had it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rowsResponse([
      row('flo', { chatId: 'chat-flo-old', createdAt: '2026-08-01T00:00:00Z' }),
      row('flo', { chatId: null, createdAt: '2026-09-01T00:00:00Z' }),
    ])))

    const { apps, ok } = await listRegistryEntriesMissingChatId()
    expect(ok).toBe(true)
    expect(apps.map((a) => a.slug)).toEqual(['flo'])
  })

  it('excludes a soft-deleted company even with no chatId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rowsResponse([
      row('flo', { chatId: null, lifecycleStatus: 'deleted' }),
    ])))

    const { apps } = await listRegistryEntriesMissingChatId()
    expect(apps).toEqual([])
  })

  it('reports ok:false (not an empty result) when the registry read fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(failResponse()))

    const { apps, ok } = await listRegistryEntriesMissingChatId()
    expect(ok).toBe(false)
    expect(apps).toEqual([])
  })
})
