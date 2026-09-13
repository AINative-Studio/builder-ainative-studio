import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import {
  listAllApps,
  listAllAppsWithStatus,
  listAppsForOwner,
  listAppsForOwnerWithStatus,
} from '@/lib/build/app-registry'

/**
 * Real bug found live (2026-09-13, core#7395): Builder's own ZeroDB registry
 * project started returning 403 on every read, platform-wide. listAllApps()'s
 * own `if (!res.ok) return []` made that outage indistinguishable from "no
 * companies exist" — a real founder (arif@8genc.com) reported their projects
 * had "disappeared" from the dashboard, when the actual cause was a database
 * outage. listAllAppsWithStatus()/listAppsForOwnerWithStatus() report whether
 * the read genuinely succeeded, so a caller (my-companies route) can surface
 * an honest error instead of a false empty list.
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function failResponse(status = 403): Response {
  return { ok: false, status, text: async () => '{"detail":"not scoped"}' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('listAllAppsWithStatus', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('reports ok:true with the real rows on a successful read', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('ember-box')]))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0].slug).toBe('ember-box')
  })

  it('reports ok:false (not a genuine empty list) when the read fails with a real error status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(403))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('reports ok:false when the fetch itself throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('listAllApps() (the pre-existing function) still returns a plain array, unaffected by the new ok tracking', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('ember-box')]))
    const apps = await listAllApps()
    expect(Array.isArray(apps)).toBe(true)
    expect(apps).toHaveLength(1)
  })

  it('listAllApps() still returns [] (not throwing) on a real failure — pre-existing fail-open callers are unaffected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(500))
    const apps = await listAllApps()
    expect(apps).toEqual([])
  })
})

describe('listAppsForOwnerWithStatus', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('filters to the owner\'s own apps and reports ok:true on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([
      row('ember-box', { ownerEmail: 'arif@8genc.com' }),
      row('other-co', { ownerEmail: 'someone-else@example.com' }),
    ]))
    const result = await listAppsForOwnerWithStatus('arif@8genc.com')
    expect(result.ok).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0].slug).toBe('ember-box')
  })

  it('reports ok:false (never a false empty list) when the underlying read fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(403))
    const result = await listAppsForOwnerWithStatus('arif@8genc.com')
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('reports ok:false for an empty/missing email, same as the pre-existing behavior', async () => {
    const result = await listAppsForOwnerWithStatus('')
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('listAppsForOwner() (the pre-existing function) still returns a plain filtered array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('ember-box', { ownerEmail: 'arif@8genc.com' })]))
    const apps = await listAppsForOwner('arif@8genc.com')
    expect(apps).toHaveLength(1)
  })
})
