import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatTaskCommitMessage,
  formatTaskPRTitle,
  formatTaskPRBody,
} from '@/lib/git/task-git-sync'
import { taskBranchName } from '@/lib/git/gitea-client'

/**
 * #907 — link issue ↔ branch ↔ commit ↔ PR for every resolved task. Depends
 * on #905 (task-resolver.ts now opens a real Gitea issue before implementation
 * and persists `giteaIssueNumber` on the task). This file proves the pure
 * naming/formatting helpers thread that issue number through in the exact
 * convention documented in docs/audits/AINATIVE_PROCESS_PARITY_GAP_2026-10-04.md
 * §1 ("branch name encodes the issue... every commit references it (`Refs #N`)...
 * every PR links it"):
 *   - branch name includes the real issue number
 *   - commit message includes `Refs #N`
 *   - PR body includes `Closes #N` (Gitea's auto-close convention — see below)
 *   - a task with NO issue number (pre-#905 row, or #905's issue-open attempt
 *     failed) falls back to today's existing behavior rather than producing a
 *     malformed reference (no `#undefined`/`#null` anywhere).
 *
 * Gitea auto-close convention: confirmed against Gitea's own documented
 * behavior (Gitea docs, "Automatically Closing Issues") — Gitea recognizes the
 * same keyword set GitHub does (close/closes/closed, fix/fixes/fixed,
 * resolve/resolves/resolved) followed by #N, scoped to the SAME repository,
 * and closes the referenced issue when the PR is merged (not just on a commit
 * to the default branch). This is what this change relies on: the task's
 * Gitea issue (#905) and the task's Gitea PR (task-git-sync.ts) are always
 * opened in the SAME company repo, so `Closes #N` in the PR body is enough —
 * no cross-repo reference syntax is needed.
 */

describe('#907 — branch name encodes the real issue number', () => {
  it('includes the issue number when one is provided', () => {
    // Convention: task/{issueNumber}-{taskId} — mirrors the documented
    // [type]/[issue-number]-[slug] branch format, adapted to this module's
    // existing task/{taskId} naming rather than inventing a new type prefix.
    expect(taskBranchName('t1', 907)).toBe('task/907-t1')
  })

  it('falls back to the existing task/{taskId} format when no issue number is given', () => {
    expect(taskBranchName('t1')).toBe('task/t1')
    expect(taskBranchName('t1', undefined)).toBe('task/t1')
    expect(taskBranchName('t1', null)).toBe('task/t1')
  })

  it('never emits a malformed reference for a non-finite/invalid issue number', () => {
    expect(taskBranchName('t1', NaN)).toBe('task/t1')
    expect(taskBranchName('t1', 0)).toBe('task/t1')
    expect(taskBranchName('t1', -5)).toBe('task/t1')
  })

  it('still sanitizes and truncates the taskId portion exactly as before', () => {
    const name = taskBranchName('task/with:special@chars', 42)
    expect(name).toBe('task/42-task-with-special-chars')
  })

  it('is deterministic for the same (taskId, issueNumber) pair', () => {
    expect(taskBranchName('x', 7)).toBe(taskBranchName('x', 7))
  })
})

describe('#907 — commit message references the real issue (Refs #N)', () => {
  it('appends "Refs #N" when an issue number is given', () => {
    const msg = formatTaskCommitMessage('t1', 'Add login button', 907)
    expect(msg).toBe('Task t1: Add login button\n\nRefs #907')
  })

  it('appends "Refs #N" even with no title', () => {
    const msg = formatTaskCommitMessage('t1', undefined, 907)
    expect(msg).toBe('Task t1\n\nRefs #907')
  })

  it('falls back to today\'s message with no Refs line when issue number is absent', () => {
    expect(formatTaskCommitMessage('t1', 'Add login button')).toBe('Task t1: Add login button')
    expect(formatTaskCommitMessage('t1', 'Add login button', undefined)).toBe('Task t1: Add login button')
    expect(formatTaskCommitMessage('t1', 'Add login button', null)).toBe('Task t1: Add login button')
  })

  it('never emits a malformed Refs line for a non-finite/invalid issue number', () => {
    expect(formatTaskCommitMessage('t1', 'x', NaN)).toBe('Task t1: x')
    expect(formatTaskCommitMessage('t1', 'x', 0)).toBe('Task t1: x')
    expect(formatTaskCommitMessage('t1', 'x', -1)).not.toContain('Refs #-1')
  })
})

describe('#907 — PR title stays unaffected (title/task-identifying, not a tracking field)', () => {
  it('formats the same as before regardless of issue number — the body carries the Closes line', () => {
    expect(formatTaskPRTitle('t1', 'Add login button')).toBe('[Task] Add login button')
  })
})

describe('#907 — PR body includes "Closes #N" so the issue auto-closes on merge', () => {
  it('includes a Closes line when an issue number is given', () => {
    const body = formatTaskPRBody({
      taskId: 't1',
      title: 'Add login button',
      fileCount: 2,
      slug: 'acme',
      giteaIssueNumber: 907,
    })
    expect(body).toContain('Closes #907')
  })

  it('places Closes up top (Gitea scans the whole body, but keep it unambiguous and visible)', () => {
    const body = formatTaskPRBody({
      taskId: 't1',
      title: 'Add login button',
      fileCount: 2,
      slug: 'acme',
      giteaIssueNumber: 907,
    })
    const closesLine = body.split('\n').find((l) => l.includes('Closes #907'))
    expect(closesLine).toBeDefined()
  })

  it('omits the Closes line entirely when no issue number is given (fallback — no malformed reference)', () => {
    const body = formatTaskPRBody({
      taskId: 't1',
      title: 'Add login button',
      fileCount: 2,
      slug: 'acme',
    })
    expect(body).not.toContain('Closes #')
    expect(body).not.toMatch(/Closes #(undefined|null|NaN)/)
  })

  it('omits the Closes line for a non-finite/invalid issue number rather than emitting a malformed one', () => {
    const bodyNaN = formatTaskPRBody({ taskId: 't1', fileCount: 1, slug: 'acme', giteaIssueNumber: NaN })
    const bodyZero = formatTaskPRBody({ taskId: 't1', fileCount: 1, slug: 'acme', giteaIssueNumber: 0 })
    const bodyNull = formatTaskPRBody({ taskId: 't1', fileCount: 1, slug: 'acme', giteaIssueNumber: null })
    expect(bodyNaN).not.toContain('Closes #')
    expect(bodyZero).not.toContain('Closes #')
    expect(bodyNull).not.toContain('Closes #')
  })

  it('keeps all existing fields intact alongside the new Closes line', () => {
    const body = formatTaskPRBody({
      taskId: 't1',
      title: 'Add login button',
      fileCount: 2,
      slug: 'acme',
      giteaIssueNumber: 907,
    })
    expect(body).toContain('## Task Summary')
    expect(body).toContain('**Title:** Add login button')
    expect(body).toContain('**Task ID:** t1')
    expect(body).toContain('**Company:** acme')
    expect(body).toContain('**Files changed:** 2')
    expect(body).toContain('Generated by Cody')
  })
})

describe('#907 — end-to-end wiring: createBranchForTask / commitTaskChanges / commitTaskWithPR thread the issue number', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv, GITEA_BASE_URL: 'https://git.test', GITEA_ADMIN_TOKEN: 'test-token' }
  })
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('createBranchForTask creates/looks-up the ISSUE-NUMBERED branch name when given an issue number', async () => {
    vi.doMock('@/lib/build/app-registry', () => ({
      resolveApp: vi.fn(async () => ({ gitOrg: 'ws-1' })),
    }))
    const calledUrls: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      calledUrls.push(`${init?.method || 'GET'} ${u}`)
      // Pre-flight getBranch for the ISSUE-NUMBERED branch — not found.
      if (u.includes('/branches/task%2F907-t1')) {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      if (u.includes('/branches/main')) {
        return { ok: true, status: 200, json: async () => ({ name: 'main', commit: { id: 'base-sha' } }) }
      }
      if (u.endsWith('/branches') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return { ok: true, status: 201, json: async () => ({ name: body.new_branch_name, commit: { id: 'base-sha' } }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createBranchForTask } = await import('@/lib/git/task-git-sync')
    const result = await createBranchForTask('triage', 't1', 907)

    expect(result.ok).toBe(true)
    expect(result.branchName).toBe('task/907-t1')
    // The POST body used the issue-numbered branch name, not the bare taskId one.
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(createCall).toBeDefined()
    const postedBody = JSON.parse(String(createCall![1]!.body))
    expect(postedBody.new_branch_name).toBe('task/907-t1')
  })

  it('createBranchForTask falls back to task/{taskId} when no issue number is given', async () => {
    vi.doMock('@/lib/build/app-registry', () => ({
      resolveApp: vi.fn(async () => ({ gitOrg: 'ws-1' })),
    }))
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/branches/task%2Ft1')) return { ok: false, status: 404, json: async () => ({}) }
      if (u.includes('/branches/main')) return { ok: true, status: 200, json: async () => ({ name: 'main', commit: { id: 'base-sha' } }) }
      if (u.endsWith('/branches') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ name: 'task/t1', commit: { id: 'base-sha' } }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createBranchForTask } = await import('@/lib/git/task-git-sync')
    const result = await createBranchForTask('triage', 't1')

    expect(result.ok).toBe(true)
    expect(result.branchName).toBe('task/t1')
  })

  it('commitTaskChanges + commitTaskWithPR: commit message has Refs #N, PR body has Closes #N, branch is issue-numbered — all three use the SAME branch name (no create/lookup mismatch)', async () => {
    vi.doMock('@/lib/build/app-registry', () => ({
      resolveApp: vi.fn(async () => ({ gitOrg: 'ws-1' })),
    }))
    const commitMessages: string[] = []
    const prBodies: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/branches/task%2F907-t1')) {
        // First call (pre-flight in createBranchForTask) = not found; later
        // getBranch (post-push) = found with updated sha.
        if ((fetchMock.mock.calls.filter(([cu]) => String(cu).includes('/branches/task%2F907-t1')).length) <= 1) {
          return { ok: false, status: 404, json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => ({ name: 'task/907-t1', commit: { id: 'new-sha' } }) }
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
        const body = JSON.parse(String(init.body))
        commitMessages.push(body.message)
        return { ok: true, status: 201, json: async () => ({}) }
      }
      if (u.endsWith('/pulls') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        prBodies.push(body.body)
        expect(body.head).toBe('task/907-t1')
        return { ok: true, status: 201, json: async () => ({ id: 1, number: 55, title: body.title, body: body.body, state: 'open', html_url: 'https://git.test/pr/55', head: { ref: body.head }, base: { ref: 'main' } }) }
      }
      if (u.includes('/pulls?')) return { ok: true, status: 200, json: async () => ([]) }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { commitTaskWithPR } = await import('@/lib/git/task-git-sync')
    const result = await commitTaskWithPR({
      taskId: 't1',
      slug: 'triage',
      files: { 'App.tsx': 'x' },
      title: 'Add login button',
      giteaIssueNumber: 907,
    })

    expect(result.ok).toBe(true)
    expect(result.branchName).toBe('task/907-t1')
    expect(result.prNumber).toBe(55)
    expect(commitMessages.length).toBeGreaterThan(0)
    commitMessages.forEach((m) => expect(m).toContain('Refs #907'))
    expect(prBodies[0]).toContain('Closes #907')
  })

  it('commitTaskChanges falls back to today\'s behavior (no Refs/Closes, plain task/{taskId} branch) when the task has no issue number', async () => {
    vi.doMock('@/lib/build/app-registry', () => ({
      resolveApp: vi.fn(async () => ({ gitOrg: 'ws-1' })),
    }))
    const commitMessages: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/branches/task%2Ft1')) {
        const priorGets = fetchMock.mock.calls.filter(([cu]) => String(cu).includes('/branches/task%2Ft1')).length
        if (priorGets <= 1) return { ok: false, status: 404, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => ({ name: 'task/t1', commit: { id: 'new-sha' } }) }
      }
      if (u.includes('/branches/main')) return { ok: true, status: 200, json: async () => ({ name: 'main', commit: { id: 'base-sha' } }) }
      if (u.endsWith('/branches') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ name: 'task/t1', commit: { id: 'base-sha' } }) }
      }
      if (u.includes('/contents/')) {
        if (!init || init.method === undefined) return { ok: false, status: 404, json: async () => ({}) }
        const body = JSON.parse(String(init.body))
        commitMessages.push(body.message)
        return { ok: true, status: 201, json: async () => ({}) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { commitTaskChanges } = await import('@/lib/git/task-git-sync')
    const result = await commitTaskChanges({
      taskId: 't1',
      slug: 'triage',
      files: { 'App.tsx': 'x' },
      title: 'Add login button',
      createPR: false,
    })

    expect(result.ok).toBe(true)
    expect(result.branchName).toBe('task/t1')
    commitMessages.forEach((m) => {
      expect(m).not.toContain('Refs #')
      expect(m).toBe('Task t1: Add login button')
    })
  })
})
