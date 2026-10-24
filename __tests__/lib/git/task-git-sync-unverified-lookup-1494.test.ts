import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1494 — createBranchForTask / commitTaskChanges resolved the company with
 * the plain `resolveApp()`, whose `null` means BOTH "this company has no
 * Gitea org" and "the registry read never completed" (the #832 anti-pattern).
 * Both collapsed into `reason: 'company_not_git_provisioned'`, so a real,
 * fully-provisioned company looked UNPROVISIONED for one retry — a
 * confirmed-sounding, terminal reason for something a retry would fix.
 *
 * This bug class fails in the SAFE direction (no branch, no commit on a failed
 * lookup), so `ok: false` is correct in every case here; what's under test is
 * that the REASON tells the two apart:
 *   - confirmed entry             → proceeds as before
 *   - confirmed missing gitOrg    → 'company_not_git_provisioned' (unchanged)
 *   - unverified registry read    → 'registry_lookup_failed' (new, retryable)
 *
 * Plus: neither function may throw on an unverified read — the lookup sits
 * OUTSIDE each function's try block, so the `.catch()` on resolveAppVerified
 * is load-bearing, and "git sync must never break the main task flow" is the
 * documented contract.
 */

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv, GITEA_BASE_URL: 'https://git.test', GITEA_ADMIN_TOKEN: 'test-token' }
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Mock app-registry with one specific resolveAppVerified answer. */
function mockRegistry(answer: { entry: unknown; verified: boolean } | Error) {
  vi.doMock('@/lib/build/app-registry', () => ({
    resolveAppVerified: vi.fn(async () => {
      if (answer instanceof Error) throw answer
      return answer
    }),
  }))
}

/** A fetch that would happily succeed — so any call to it proves the lookup
 *  gate did NOT stop the flow. */
function permissiveFetch() {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    // getBranch pre-flight for the task branch — not found, so the flow
    // proceeds to actually create it.
    if (u.includes('/branches/task%2F') && (!init || init.method === undefined)) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    if (u.includes('/branches/main')) {
      return { ok: true, status: 200, json: async () => ({ name: 'main', commit: { id: 'base-sha' } }) }
    }
    if (u.endsWith('/branches') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      return { ok: true, status: 201, json: async () => ({ name: body.new_branch_name, commit: { id: 'base-sha' } }) }
    }
    if (u.includes('/contents/')) {
      if (!init || init.method === undefined) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 201, json: async () => ({}) }
    }
    // Anything unmatched is a miss, never an accidental empty success.
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', f)
  return f
}

describe('createBranchForTask — unverified registry lookup (#1494)', () => {
  it('reports registry_lookup_failed (NOT company_not_git_provisioned) when the read could not be completed', async () => {
    mockRegistry({ entry: null, verified: false })
    const fetchMock = permissiveFetch()

    const { createBranchForTask } = await import('@/lib/git/task-git-sync')
    const result = await createBranchForTask('triage', 't1')

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('registry_lookup_failed')
    // Safe direction unchanged: no branch is created on an unknown lookup.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still reports company_not_git_provisioned for a CONFIRMED company with no gitOrg', async () => {
    mockRegistry({ entry: { slug: 'triage', chatId: 'c1' }, verified: true })
    const fetchMock = permissiveFetch()

    const { createBranchForTask } = await import('@/lib/git/task-git-sync')
    const result = await createBranchForTask('triage', 't1')

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('company_not_git_provisioned')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still reports company_not_git_provisioned for a CONFIRMED missing company', async () => {
    mockRegistry({ entry: null, verified: true })
    permissiveFetch()

    const { createBranchForTask } = await import('@/lib/git/task-git-sync')
    const result = await createBranchForTask('ghost', 't1')

    expect(result).toEqual({ ok: false, reason: 'company_not_git_provisioned' })
  })

  it('proceeds normally for a CONFIRMED, provisioned company (unchanged success path)', async () => {
    mockRegistry({ entry: { gitOrg: 'ws-1' }, verified: true })
    permissiveFetch()

    const { createBranchForTask } = await import('@/lib/git/task-git-sync')
    const result = await createBranchForTask('triage', 't1')

    expect(result.ok).toBe(true)
    expect(result.branchName).toBe('task/t1')
  })

  it('never throws when the registry read itself rejects — treated as unverified', async () => {
    mockRegistry(new Error('zerodb timeout'))
    permissiveFetch()

    const { createBranchForTask } = await import('@/lib/git/task-git-sync')
    await expect(createBranchForTask('triage', 't1')).resolves.toEqual({
      ok: false,
      reason: 'registry_lookup_failed',
    })
  })
})

describe('commitTaskChanges — unverified registry lookup (#1494)', () => {
  const OPTS = { taskId: 't1', slug: 'triage', files: { 'App.tsx': 'export default function App() { return null }' } }

  it('reports registry_lookup_failed (NOT company_not_git_provisioned) when the read could not be completed', async () => {
    mockRegistry({ entry: null, verified: false })
    const fetchMock = permissiveFetch()

    const { commitTaskChanges } = await import('@/lib/git/task-git-sync')
    const result = await commitTaskChanges(OPTS)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('registry_lookup_failed')
    // Safe direction unchanged: nothing is pushed on an unknown lookup.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still reports company_not_git_provisioned for a CONFIRMED company with no gitOrg', async () => {
    mockRegistry({ entry: { slug: 'triage', chatId: 'c1' }, verified: true })
    const fetchMock = permissiveFetch()

    const { commitTaskChanges } = await import('@/lib/git/task-git-sync')
    const result = await commitTaskChanges(OPTS)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('company_not_git_provisioned')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates its inputs BEFORE the registry read, so a bad call is not blamed on the lookup', async () => {
    mockRegistry({ entry: null, verified: false })
    permissiveFetch()

    const { commitTaskChanges } = await import('@/lib/git/task-git-sync')
    const result = await commitTaskChanges({ ...OPTS, taskId: '' })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('taskId is required')
  })

  it('never throws when the registry read itself rejects — treated as unverified', async () => {
    mockRegistry(new Error('zerodb timeout'))
    permissiveFetch()

    const { commitTaskChanges } = await import('@/lib/git/task-git-sync')
    await expect(commitTaskChanges(OPTS)).resolves.toEqual({
      ok: false,
      reason: 'registry_lookup_failed',
    })
  })
})
