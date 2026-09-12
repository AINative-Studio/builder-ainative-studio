import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real gap found live (#698 follow-up): commitTaskChanges's catch-all
 * 'commit_error' string discarded the actual thrown reason (e.g. a real
 * Gitea 4xx/5xx from createTaskPR), making a live failure unnecessarily
 * hard to diagnose — confirmed hitting this exact path live while
 * verifying #582's edit-app pipeline end-to-end.
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

describe('commitTaskChanges — real error detail (#698 follow-up)', () => {
  it('includes the real thrown message in the failure reason instead of a bare constant', async () => {
    vi.doMock('@/lib/build/app-registry', () => ({
      resolveApp: vi.fn(async () => ({ gitOrg: 'ws-1' })),
    }))
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      // getBranch pre-flight for the task branch — not found, proceed to create.
      if (u.includes('/branches/task%2F')) return { ok: false, status: 404, json: async () => ({}) }
      // getDefaultBranchSha
      if (u.includes('/branches/main')) return { ok: true, status: 200, json: async () => ({ name: 'main', commit: { id: 'base-sha' } }) }
      // Create branch
      if (u.endsWith('/branches') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ name: 'task/t1', commit: { id: 'base-sha' } }) }
      }
      // Push file contents (both the pre-flight GET and the PUT/POST write)
      if (u.includes('/contents/')) {
        if (!init || init.method === undefined) return { ok: false, status: 404, json: async () => ({}) }
        return { ok: true, status: 201, json: async () => ({}) }
      }
      // Re-fetch branch after push
      if (u.includes('/branches/task%2Ft1')) return { ok: true, status: 200, json: async () => ({ name: 'task/t1', commit: { id: 'new-sha' } }) }
      // PR creation — simulate a real Gitea 500
      if (u.endsWith('/pulls') && init?.method === 'POST') return { ok: false, status: 500, json: async () => ({}) }
      if (u.includes('/pulls?')) return { ok: true, status: 200, json: async () => ([]) }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { commitTaskChanges } = await import('@/lib/git/task-git-sync')
    const result = await commitTaskChanges({
      taskId: 't1', slug: 'triage', files: { 'App.tsx': 'x' }, title: 'change the headline', createPR: true,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('commit_error')
    expect(result.reason).toMatch(/failed: 500/)
  })
})
