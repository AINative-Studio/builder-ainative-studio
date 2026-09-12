import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real bug found live (#582 investigation): Gitea's actual branches API
 * response (confirmed directly against production —
 * GET /repos/{org}/{repo}/branches/main) nests the commit hash under
 * `commit.id`, NOT `commit.sha`. getDefaultBranchSha previously only ever
 * read `.commit.sha`, which is always undefined against the real API — so
 * every task-branch creation (createTaskBranch, used by BOTH the nightly
 * loop's task-resolver.ts AND the new #582 live-chat edit path) fell through
 * to `if (!defaultSha) return null` and failed with 'branch_creation_failed',
 * even against a repo with a perfectly real, existing main branch.
 */

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv, GITEA_BASE_URL: 'https://git.test', GITEA_ADMIN_TOKEN: 'test-token' }
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('getDefaultBranchSha — real Gitea response shape (#582)', () => {
  it('reads the SHA from commit.id (the real field Gitea returns), not commit.sha', async () => {
    const fetchMock = vi.fn(async (_url?: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ name: 'main', commit: { id: 'abc123realgiteasha', url: 'https://git.test/commit/abc123' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { getDefaultBranchSha } = await import('@/lib/git/gitea-client')
    const sha = await getDefaultBranchSha('ws-1', 'triage')
    expect(sha).toBe('abc123realgiteasha')
  })

  it('falls back to commit.sha if a response ever carries that shape instead (back-compat)', async () => {
    const fetchMock = vi.fn(async (_url?: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ name: 'main', commit: { sha: 'legacy-sha-shape' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { getDefaultBranchSha } = await import('@/lib/git/gitea-client')
    const sha = await getDefaultBranchSha('ws-1', 'triage')
    expect(sha).toBe('legacy-sha-shape')
  })

  it('falls back to master when main 404s, still reading commit.id', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/branches/main')) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ name: 'master', commit: { id: 'master-sha' } }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getDefaultBranchSha } = await import('@/lib/git/gitea-client')
    const sha = await getDefaultBranchSha('ws-1', 'triage')
    expect(sha).toBe('master-sha')
  })

  it('returns null when neither main nor master exists', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const { getDefaultBranchSha } = await import('@/lib/git/gitea-client')
    const sha = await getDefaultBranchSha('ws-1', 'triage')
    expect(sha).toBeNull()
  })
})

describe('createTaskBranch — uses the real SHA to actually create a branch (#582)', () => {
  it('creates a branch against the real default-branch SHA read from commit.id', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/branches/task%2Ft-abc')) return { ok: false, status: 404, json: async () => ({}) }
      if (u.includes('/branches/main')) return { ok: true, status: 200, json: async () => ({ name: 'main', commit: { id: 'real-base-sha' } }) }
      if (u.endsWith('/branches') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        expect(body.old_ref_name).toBe('real-base-sha')
        return { ok: true, status: 201, json: async () => ({ name: 'task/t-abc', commit: { id: 'real-base-sha' } }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createTaskBranch } = await import('@/lib/git/gitea-client')
    const branch = await createTaskBranch('ws-1', 'triage', 't-abc')
    expect(branch).not.toBeNull()
    expect(branch?.name).toBe('task/t-abc')
  })
})
