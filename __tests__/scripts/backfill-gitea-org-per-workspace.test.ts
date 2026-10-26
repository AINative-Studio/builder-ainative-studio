import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

process.env.ZERODB_API_KEY = 'test-admin-key'

import { resolveFounderWorkspaceId } from '@/scripts/backfill-gitea-org-per-workspace-logic'
import { orgNameForWorkspace } from '@/lib/git/gitea-client'

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

/**
 * #1545 — the Gitea org-per-workspace migration script.
 *
 * resolveFounderWorkspaceId turns a company's ownerEmail into a real
 * workspaceId via the admin endpoint core built for exactly this
 * (builder#1555 → core PR #9214, confirmed live 2026-10-26): `GET
 * /api/v1/admin/users/by-email/{email}/workspaces`.
 *
 * This test exists specifically to catch the real footgun class this file's
 * sibling (backfill-zerodb-keys-args.test.ts, #1013) already names: a
 * "helpful" fallback that silently WIDENS what a migration acts on — here,
 * that would mean falling back to the already-proven-untrustworthy stored
 * `AppEntry.workspaceId` (the exact same #1543 bug, just on the ZeroDB-
 * registry side) instead of truly declining to act on an unresolvable case.
 * Every failure mode below must return null, never a guessed/fallback id.
 */
describe('resolveFounderWorkspaceId (#1545, wired to core#9214)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves the real default workspace id (workspaces[0], per the endpoint\'s own is_default DESC ordering)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        user_id: 'u1',
        email: 'founder@ainative.studio',
        workspaces: [
          { id: 'ws-real-default', name: 'Acme', is_default: true, created_at: '2026-01-01T00:00:00Z' },
          { id: 'ws-secondary', name: 'Side project', is_default: false, created_at: '2026-02-01T00:00:00Z' },
        ],
      }),
    )
    const result = await resolveFounderWorkspaceId('founder@ainative.studio')
    expect(result).toBe('ws-real-default')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/v1/admin/users/by-email/founder%40ainative.studio/workspaces')
    expect((init as RequestInit).headers).toMatchObject({ 'X-API-Key': 'test-admin-key' })
  })

  it('returns null for an unknown email (404) — a real "no such founder" case, not an error to retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { detail: 'not found' }))
    expect(await resolveFounderWorkspaceId('ghost@nowhere.test')).toBeNull()
  })

  it('returns null when the response has zero workspaces — never fabricates one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { user_id: 'u1', email: 'x@x.com', workspaces: [] }))
    expect(await resolveFounderWorkspaceId('x@x.com')).toBeNull()
  })

  it('returns null on a malformed response (missing workspaces key entirely)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { user_id: 'u1' }))
    expect(await resolveFounderWorkspaceId('x@x.com')).toBeNull()
  })

  it('returns null when the admin API errors (401/500), never falls back to a guess', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, { detail: 'internal error' }))
    expect(await resolveFounderWorkspaceId('founder@ainative.studio')).toBeNull()
  })

  it('returns null when fetch itself throws (network error), never propagates', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'))
    expect(await resolveFounderWorkspaceId('founder@ainative.studio')).toBeNull()
  })

  it('returns null for an empty/garbage email without even calling fetch', async () => {
    expect(await resolveFounderWorkspaceId('')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null without calling fetch when no admin API key is configured', async () => {
    const prevZerodb = process.env.ZERODB_API_KEY
    const prevAinative = process.env.AINATIVE_API_KEY
    const prevLegacy = process.env.API_Key
    delete process.env.ZERODB_API_KEY
    delete process.env.AINATIVE_API_KEY
    delete process.env.API_Key
    vi.resetModules()
    const { resolveFounderWorkspaceId: freshResolve } = await import('@/scripts/backfill-gitea-org-per-workspace-logic')
    const result = await freshResolve('founder@ainative.studio')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    process.env.ZERODB_API_KEY = prevZerodb
    if (prevAinative) process.env.AINATIVE_API_KEY = prevAinative
    if (prevLegacy) process.env.API_Key = prevLegacy
  })
})

/**
 * Sanity check on the org-equality comparison main() uses to decide
 * `already_correct` vs `would_transfer`/`transferred`: orgNameForWorkspace
 * must be the SAME derivation on both the "current" and "resolved" sides,
 * or the comparison is meaningless. (Pure regression guard — the function
 * itself is gitea-client.ts's, already covered by its own #354 test file;
 * this just pins the specific property this script's comparison depends on.)
 */
describe('org-name derivation used for the already-correct check', () => {
  it('is deterministic and prefixed, so comparing two derived org names is a valid equality check', () => {
    expect(orgNameForWorkspace('abc-123')).toBe(orgNameForWorkspace('abc-123'))
    expect(orgNameForWorkspace('abc-123')).not.toBe(orgNameForWorkspace('xyz-999'))
    expect(orgNameForWorkspace('abc-123')).toMatch(/^ws-/)
  })
})
