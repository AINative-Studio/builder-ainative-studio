import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1086 — Gitea → build_tasks sync. Covers the PURE mapping/matching logic
 * (state mapping, branch parsing, synthetic-row shaping, scope key, dedup)
 * directly, and the I/O orchestrator (`syncTaskFromPREvent`) by mocking
 * task-store.ts's collaborators — same strategy as
 * webhooks-gitea-push-redeploy.test.ts (#392) for the sibling push handler.
 */

import {
  giteaTaskBranchOf,
  mapPREventToStage,
  syntheticTaskFromPR,
  syntheticScopeKey,
  findTaskByBranch,
  type GitTaskSyncInput,
} from '@/lib/git/task-sync-from-git'
import type { BuildTask } from '@/lib/build/task-store'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('giteaTaskBranchOf (pure, #1086)', () => {
  it('recognizes a task/{taskId} branch', () => {
    expect(giteaTaskBranchOf('task/t1')).toBe('task/t1')
  })
  it('recognizes a task/{issueNumber}-{taskId} branch', () => {
    expect(giteaTaskBranchOf('task/907-t1')).toBe('task/907-t1')
  })
  it('returns null for a branch created directly in Gitea (no task/ prefix)', () => {
    expect(giteaTaskBranchOf('fix/manual-patch')).toBeNull()
    expect(giteaTaskBranchOf('main')).toBeNull()
  })
  it('returns null for empty/missing input', () => {
    expect(giteaTaskBranchOf('')).toBeNull()
    expect(giteaTaskBranchOf(undefined)).toBeNull()
    expect(giteaTaskBranchOf(null)).toBeNull()
  })
  it('trims whitespace before checking', () => {
    expect(giteaTaskBranchOf('  task/t1  ')).toBe('task/t1')
  })
})

describe('mapPREventToStage (pure, #1086 req 2)', () => {
  it('maps a merged PR (action=closed, merged=true) to completed', () => {
    expect(mapPREventToStage({ action: 'closed', merged: true }, null)).toBe('completed')
    expect(mapPREventToStage({ action: 'closed', merged: true }, 'approve')).toBe('completed')
  })
  it('maps a closed-without-merging PR to rejected', () => {
    expect(mapPREventToStage({ action: 'closed', merged: false }, null)).toBe('rejected')
    expect(mapPREventToStage({ action: 'closed' }, null)).toBe('rejected')
  })
  it('maps an open PR with the gate not yet resolved to in_progress', () => {
    expect(mapPREventToStage({ action: 'opened' }, null)).toBe('in_progress')
    expect(mapPREventToStage({ action: 'opened' }, 'pending')).toBe('in_progress')
    expect(mapPREventToStage({ action: 'reopened' }, null)).toBe('in_progress')
  })
  it('maps an open PR whose gate verdict APPROVED to in_progress (still open, not done)', () => {
    expect(mapPREventToStage({ action: 'opened' }, 'approve')).toBe('in_progress')
  })
  it('maps an open PR whose standards gate FAILED to failed — the real CI/CD signal', () => {
    expect(mapPREventToStage({ action: 'opened' }, 'request-changes')).toBe('failed')
    expect(mapPREventToStage({ action: 'synchronize' }, 'request-changes')).toBe('failed')
  })
  it('handles BOTH Gitea synchronize spellings (go-gitea#27118 — wire value is "synchronized")', () => {
    expect(mapPREventToStage({ action: 'synchronize' }, null)).toBe('in_progress')
    expect(mapPREventToStage({ action: 'synchronized' }, null)).toBe('in_progress')
    expect(mapPREventToStage({ action: 'synchronized' }, 'request-changes')).toBe('failed')
  })
  it('is case-insensitive on action', () => {
    expect(mapPREventToStage({ action: 'CLOSED', merged: true }, null)).toBe('completed')
  })
  it('returns null for an action with no implied stage transition (edited, labeled, unknown)', () => {
    expect(mapPREventToStage({ action: 'edited' }, null)).toBeNull()
    expect(mapPREventToStage({ action: 'labeled' }, null)).toBeNull()
    expect(mapPREventToStage({ action: '' }, null)).toBeNull()
  })
})

describe('syntheticTaskFromPR (pure, #1086 req 3)', () => {
  it('builds a synthetic row prefixed [Gitea], sourced swarm, with the branch set', () => {
    const row = syntheticTaskFromPR(
      { number: 42, title: 'Manual hotfix', html_url: 'https://git.example/pr/42' },
      'in_progress',
      'task/manual-42',
    )
    expect(row.title).toBe('[Gitea] Manual hotfix')
    expect(row.source).toBe('swarm')
    expect(row.stage).toBe('in_progress')
    expect(row.giteaBranch).toBe('task/manual-42')
    expect(row.giteaSynthetic).toBe(true)
    expect(row.detail).toContain('https://git.example/pr/42')
  })
  it('falls back to a PR-number title when the PR has no title', () => {
    const row = syntheticTaskFromPR({ number: 7 }, 'completed', 'task/x-7')
    expect(row.title).toBe('[Gitea] PR #7')
  })
})

describe('syntheticScopeKey (pure, #1086 req 4)', () => {
  it('is company-wide, not tied to any founder session', () => {
    expect(syntheticScopeKey('Acme')).toBe('git:webhook::acme')
  })
  it('is recognized by scopeKeyBelongsToCompany', async () => {
    const { scopeKeyBelongsToCompany } = await import('@/lib/build/task-store')
    expect(scopeKeyBelongsToCompany(syntheticScopeKey('acme'), 'acme')).toBe(true)
  })
})

describe('findTaskByBranch (pure, #1086 req 3)', () => {
  const mk = (over: Partial<BuildTask>): BuildTask => ({
    id: over.id || 't1',
    scopeKey: over.scopeKey || 'a::acme',
    title: over.title || 'Task',
    stage: over.stage || 'todo',
    source: over.source || 'cody',
    taskId: over.taskId ?? null,
    storyPoints: null,
    estimateRationale: null,
    giteaBranch: over.giteaBranch,
    giteaSynthetic: over.giteaSynthetic,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })

  it('finds the row whose giteaBranch matches', () => {
    const tasks = [mk({ id: 't1', giteaBranch: 'task/a' }), mk({ id: 't2', giteaBranch: 'task/b' })]
    expect(findTaskByBranch(tasks, 'task/b')?.id).toBe('t2')
  })
  it('returns null when no row matches', () => {
    const tasks = [mk({ id: 't1', giteaBranch: 'task/a' })]
    expect(findTaskByBranch(tasks, 'task/zzz')).toBeNull()
  })
  it('returns null for an empty branch or empty list', () => {
    expect(findTaskByBranch([], 'task/a')).toBeNull()
    expect(findTaskByBranch([mk({ giteaBranch: 'task/a' })], '')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// I/O orchestrator — syncTaskFromPREvent
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  listTasksForCompany: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
}))

vi.mock('@/lib/build/task-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/task-store')>('@/lib/build/task-store')
  return {
    ...actual,
    listTasksForCompany: h.listTasksForCompany,
    updateTask: h.updateTask,
    createTask: h.createTask,
  }
})

describe('syncTaskFromPREvent (I/O orchestration, #1086)', () => {
  beforeEach(() => {
    h.listTasksForCompany.mockReset().mockResolvedValue([])
    h.updateTask.mockReset().mockResolvedValue(true)
    h.createTask.mockReset().mockResolvedValue({ id: 'new' })
  })

  const payload = (over: Partial<GitTaskSyncInput> = {}): GitTaskSyncInput => ({
    action: 'opened',
    pullRequest: { number: 1, title: 'Some task', head: { ref: 'task/t1' } },
    repository: { name: 'acme', owner: { login: 'ws-w1' } },
    ...over,
  })

  it('ignores a PR whose head branch is not a task/ branch — never touches the store', async () => {
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ pullRequest: { number: 1, head: { ref: 'fix/manual' } } }))
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('not_a_task_branch')
    expect(h.listTasksForCompany).not.toHaveBeenCalled()
  })

  it('ignores an action with no stage transition (e.g. edited) without touching the store', async () => {
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ action: 'edited' }))
    expect(result.ok).toBe(true)
    expect(result.reason).toMatch(/ignored_action/)
    expect(h.listTasksForCompany).not.toHaveBeenCalled()
  })

  it('updates the EXISTING task row matched by branch — never creates a duplicate', async () => {
    h.listTasksForCompany.mockResolvedValue([
      { id: 'real-1', scopeKey: 'founder@x.com::acme', giteaBranch: 'task/t1', stage: 'todo' },
    ])
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ action: 'closed', pullRequest: { number: 1, merged: true, head: { ref: 'task/t1' } } }))
    expect(result.ok).toBe(true)
    expect(result.matched).toBe('existing')
    expect(result.stage).toBe('completed')
    expect(h.updateTask).toHaveBeenCalledWith('founder@x.com::acme', 'real-1', { stage: 'completed' })
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('creates a synthetic row when no task row matches the branch — company-wide scope key', async () => {
    h.listTasksForCompany.mockResolvedValue([])
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ action: 'opened' }))
    expect(result.ok).toBe(true)
    expect(result.matched).toBe('synthetic')
    expect(h.createTask).toHaveBeenCalledWith(
      'git:webhook::acme',
      expect.objectContaining({ giteaBranch: 'task/t1', giteaSynthetic: true, skipEstimate: true }),
    )
  })

  it('maps a standards-gate rejection on an open PR to failed for an existing task', async () => {
    h.listTasksForCompany.mockResolvedValue([
      { id: 'real-1', scopeKey: 'founder@x.com::acme', giteaBranch: 'task/t1', stage: 'in_progress' },
    ])
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ action: 'synchronize' }), 'request-changes')
    expect(result.stage).toBe('failed')
    expect(h.updateTask).toHaveBeenCalledWith('founder@x.com::acme', 'real-1', { stage: 'failed' })
  })

  it('maps a closed-without-merge PR to rejected for an existing task', async () => {
    h.listTasksForCompany.mockResolvedValue([
      { id: 'real-1', scopeKey: 'founder@x.com::acme', giteaBranch: 'task/t1', stage: 'in_progress' },
    ])
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ action: 'closed', pullRequest: { number: 1, merged: false, head: { ref: 'task/t1' } } }))
    expect(result.stage).toBe('rejected')
    expect(h.updateTask).toHaveBeenCalledWith('founder@x.com::acme', 'real-1', { stage: 'rejected' })
  })

  it('rejects an invalid payload (no repository name) without throwing', async () => {
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ repository: { name: '', owner: { login: 'x' } } }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_payload')
  })

  it('surfaces an update failure honestly without throwing', async () => {
    h.listTasksForCompany.mockResolvedValue([
      { id: 'real-1', scopeKey: 'founder@x.com::acme', giteaBranch: 'task/t1', stage: 'todo' },
    ])
    h.updateTask.mockResolvedValue(false)
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ action: 'opened' }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('update_failed')
  })

  it('never throws even when a collaborator rejects — surfaces a structured failure', async () => {
    h.listTasksForCompany.mockRejectedValue(new Error('zerodb timeout'))
    const { syncTaskFromPREvent } = await import('@/lib/git/task-sync-from-git')
    const result = await syncTaskFromPREvent(payload({ action: 'opened' }))
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/zerodb timeout/)
  })
})
