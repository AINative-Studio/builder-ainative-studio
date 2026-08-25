import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  versionScopeKey,
  coerceVersionMeta,
  indexMetaById,
  fallbackMessage,
  joinVersions,
  singleVersionFallback,
  recordVersion,
  loadVersionIndex,
  type VersionMeta,
} from '@/lib/build/version-store'
import type { RailwayDeployment } from '@/lib/build/railway-deploy'

/**
 * #62 — per-company version index + JOIN with Railway deployment history.
 *
 * The pure join/index/fallback logic is exact and unit-testable without a network;
 * the ZeroDB IO (recordVersion/loadVersionIndex) is exercised with a mocked fetch
 * (mirrors task-store.test conventions) so no real ZeroDB call is ever made.
 */
function zdb(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

describe('versionScopeKey — keys identically to chat/tasks', () => {
  it('composes owner + company (guest owner when no session)', () => {
    const k = versionScopeKey(null as any, 'acme')
    expect(k).toContain('acme')
    // Same company under the same (guest) owner is stable.
    expect(versionScopeKey(null as any, 'acme')).toBe(k)
  })
  it('scopes differ by company', () => {
    expect(versionScopeKey(null as any, 'acme')).not.toBe(versionScopeKey(null as any, 'other'))
  })
})

describe('coerceVersionMeta', () => {
  it('returns null with no deploymentId', () => {
    expect(coerceVersionMeta({})).toBeNull()
    expect(coerceVersionMeta(null)).toBeNull()
  })
  it('coerces a snake_case row (row_data wrapper)', () => {
    const m = coerceVersionMeta(
      { row_data: { deployment_id: 'dep-1', scope_key: 'o::acme', message: 'feat: x', commit_sha: 'abc123', created_at: '2026-08-24T00:00:00Z' } },
    )
    expect(m).toMatchObject({ deploymentId: 'dep-1', scopeKey: 'o::acme', message: 'feat: x', commitSha: 'abc123' })
  })
  it('accepts camelCase + falls back scopeKey', () => {
    const m = coerceVersionMeta({ deploymentId: 'dep-2', message: 'y' }, 'scope-fallback')
    expect(m?.deploymentId).toBe('dep-2')
    expect(m?.scopeKey).toBe('scope-fallback')
  })
  it('truncates sha to 12 chars', () => {
    const m = coerceVersionMeta({ deploymentId: 'd', commitSha: 'abcdefghijklmnop' })
    expect(m?.commitSha).toBe('abcdefghijkl')
  })
})

describe('indexMetaById — latest row per deploymentId wins', () => {
  it('keeps the newest by createdAt', () => {
    const rows: VersionMeta[] = [
      { deploymentId: 'd1', scopeKey: 's', message: 'old', createdAt: '2026-08-20T00:00:00Z' },
      { deploymentId: 'd1', scopeKey: 's', message: 'new', createdAt: '2026-08-24T00:00:00Z' },
      { deploymentId: 'd2', scopeKey: 's', message: 'other', createdAt: '2026-08-22T00:00:00Z' },
    ]
    const map = indexMetaById(rows)
    expect(map.get('d1')?.message).toBe('new')
    expect(map.get('d2')?.message).toBe('other')
    expect(map.size).toBe(2)
  })
  it('handles empty/garbage input', () => {
    expect(indexMetaById([]).size).toBe(0)
    expect(indexMetaById([{ deploymentId: '', scopeKey: 's', createdAt: '' } as VersionMeta]).size).toBe(0)
  })
})

describe('fallbackMessage — honest, never fabricated', () => {
  it('single deploy → v1', () => {
    expect(fallbackMessage(0, 1)).toBe('v1 · initial deploy')
    expect(fallbackMessage(0, 0)).toBe('v1 · initial deploy')
  })
  it('multi: newest is highest vN', () => {
    // 3 deploys, index 0 = newest → v3
    expect(fallbackMessage(0, 3)).toBe('v3 · deploy')
    expect(fallbackMessage(2, 3)).toBe('v1 · deploy')
  })
})

describe('joinVersions — Railway history JOINed with persisted metadata', () => {
  const deployments: RailwayDeployment[] = [
    { id: 'new', status: 'live', current: true, createdAt: '2026-08-24T02:00:00Z' },
    { id: 'mid', status: 'success', current: false, createdAt: '2026-08-22T02:00:00Z', message: 'railway-meta msg' },
    { id: 'old', status: 'failed', current: false, createdAt: '2026-08-20T02:00:00Z' },
  ]

  it('prefers persisted message, then railway meta, then vN fallback', () => {
    const index = new Map<string, VersionMeta>([
      ['new', { deploymentId: 'new', scopeKey: 's', message: 'feat: low-stock alerts', commitSha: 'zzz999', createdAt: '' }],
    ])
    const out = joinVersions(deployments, index)
    // persisted metadata wins for 'new'
    expect(out[0]).toMatchObject({ deploymentId: 'new', message: 'feat: low-stock alerts', commitSha: 'zzz999', current: true })
    // railway git meta used for 'mid'
    expect(out[1].message).toBe('railway-meta msg')
    // fallback vN for 'old' (no persisted, no railway meta) — index 2 of 3 → v1
    expect(out[2].message).toBe('v1 · deploy')
  })

  it('computes canRollback: only completed, non-current deploys', () => {
    const out = joinVersions(deployments, new Map())
    expect(out.find((v) => v.deploymentId === 'new')?.canRollback).toBe(false) // current
    expect(out.find((v) => v.deploymentId === 'mid')?.canRollback).toBe(true) // prior success
    expect(out.find((v) => v.deploymentId === 'old')?.canRollback).toBe(false) // failed
  })

  it('handles empty input', () => {
    expect(joinVersions([], new Map())).toEqual([])
  })
})

describe('singleVersionFallback — honest empty state', () => {
  it('yields one non-rollbackable current v1', () => {
    const [v] = singleVersionFallback()
    expect(v).toMatchObject({ status: 'live', current: true, canRollback: false })
    expect(v.message).toContain('v1')
  })
  it('uses a provided deploymentId when given', () => {
    expect(singleVersionFallback('dep-x')[0].deploymentId).toBe('dep-x')
  })
})

describe('recordVersion / loadVersionIndex — ZeroDB IO (mocked)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('recordVersion returns null with no scope or deploymentId (no fetch)', async () => {
    expect(await recordVersion('', { deploymentId: 'd' })).toBeNull()
    expect(await recordVersion('s', { deploymentId: '' })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recordVersion POSTs a row and returns the saved meta', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(zdb({ ok: true }))
    const saved = await recordVersion('o::acme', { deploymentId: 'dep-1', message: 'feat: x', commitSha: 'abc123' })
    expect(saved).toMatchObject({ deploymentId: 'dep-1', scopeKey: 'o::acme', message: 'feat: x', commitSha: 'abc123' })
    const body = String(fetchMock.mock.calls[0][1]?.body || '')
    expect(body).toContain('dep-1')
    expect(body).toContain('feat: x')
  })

  it('recordVersion returns null when ZeroDB write fails (never throws)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response)
    expect(await recordVersion('s', { deploymentId: 'd' })).toBeNull()
  })

  it('loadVersionIndex returns empty map with no scope (no fetch)', async () => {
    const map = await loadVersionIndex('')
    expect(map.size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loadVersionIndex queries + indexes rows (latest-wins)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      zdb({
        data: [
          { row_data: { deployment_id: 'd1', scope_key: 's', message: 'old', created_at: '2026-08-20T00:00:00Z' } },
          { row_data: { deployment_id: 'd1', scope_key: 's', message: 'new', created_at: '2026-08-24T00:00:00Z' } },
        ],
      }),
    )
    const map = await loadVersionIndex('s')
    expect(map.get('d1')?.message).toBe('new')
  })

  it('loadVersionIndex returns empty map on error (never throws)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response)
    const map = await loadVersionIndex('s')
    expect(map.size).toBe(0)
  })
})
