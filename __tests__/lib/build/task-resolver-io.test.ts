import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #374 (epic #371) — full end-to-end resolveTask() pipeline tests, mocking
 * every I/O boundary (Gitea, app-registry, task-implementer, coverage-runner,
 * task-store) so the ORCHESTRATION logic is proven independent of any real
 * network/subprocess call. Real subprocess proof already lives in
 * coverage-runner.integration.test.ts (#372) and doesn't need repeating here.
 */

const h = vi.hoisted(() => ({
  fetchRepoFiles: vi.fn(),
  mergeTaskPR: vi.fn(),
  commitTaskWithPR: vi.fn(),
  resolveApp: vi.fn(),
  setAppRailwayService: vi.fn(),
  implementTask: vi.fn(),
  runCoverage: vi.fn(),
  updateTask: vi.fn(),
  deployCompanyFromGitea: vi.fn(),
  companyDeployEnabled: vi.fn(),
}))

vi.mock('@/lib/git/gitea-client', () => ({ fetchRepoFiles: h.fetchRepoFiles, mergeTaskPR: h.mergeTaskPR }))
vi.mock('@/lib/git/task-git-sync', () => ({ commitTaskWithPR: h.commitTaskWithPR }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp, setAppRailwayService: h.setAppRailwayService }))
vi.mock('@/lib/build/task-implementer', () => ({ implementTask: h.implementTask }))
vi.mock('@/lib/build/coverage-runner', () => ({ runCoverage: h.runCoverage }))
vi.mock('@/lib/build/task-store', () => ({ updateTask: h.updateTask }))
vi.mock('@/lib/build/company-deploy', () => ({
  deployCompanyFromGitea: h.deployCompanyFromGitea,
  companyDeployEnabled: h.companyDeployEnabled,
}))
vi.mock('@/lib/build/instant-db', () => ({ BUILDER_WORKSPACE_ID: 'builder-ws-default' }))

import { resolveTask } from '@/lib/build/task-resolver'
import type { BuildTask } from '@/lib/build/task-store'

const TASK: BuildTask = {
  id: 't_abc123',
  scopeKey: 'owner::slug',
  title: 'Add a dark mode toggle',
  stage: 'todo',
  source: 'cody',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.updateTask.mockResolvedValue(true)
  h.mergeTaskPR.mockResolvedValue(false)
  h.companyDeployEnabled.mockReturnValue(false)
  h.setAppRailwayService.mockResolvedValue(true)
})

describe('resolveTask — end-to-end orchestration', () => {
  it('marks in_progress immediately, before any other step', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue({})
    h.implementTask.mockResolvedValue({ ok: true, files: { 'a.ts': 'x' } })
    h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/1' })
    h.runCoverage.mockResolvedValue({ coveragePercent: 90, testable: true, passed: true })

    await resolveTask('owner::slug', TASK, 'slug')
    expect(h.updateTask).toHaveBeenNthCalledWith(1, 'owner::slug', 't_abc123', { stage: 'in_progress' })
  })

  it('fails honestly when the company is not git-provisioned', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: undefined })
    const result = await resolveTask('owner::slug', TASK, 'slug')
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('failed')
    expect(result.reason).toMatch(/not git-provisioned/i)
    expect(h.updateTask).toHaveBeenLastCalledWith('owner::slug', 't_abc123', { stage: 'failed', output: result.reason })
    // Never reaches implement/commit/coverage once git-provisioning is missing.
    expect(h.implementTask).not.toHaveBeenCalled()
  })

  it('fails honestly when the current repo state cannot be fetched from Gitea', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue(null)
    const result = await resolveTask('owner::slug', TASK, 'slug')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/could not read/i)
    expect(h.implementTask).not.toHaveBeenCalled()
  })

  it('fails honestly when the implementation step fails — never commits a broken/fabricated result', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
    h.implementTask.mockResolvedValue({ ok: false, reason: 'Story is ambiguous.' })
    const result = await resolveTask('owner::slug', TASK, 'slug')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Story is ambiguous.')
    expect(h.commitTaskWithPR).not.toHaveBeenCalled()
  })

  it('fails honestly when the git commit fails — never marks completed on an uncommitted change', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
    h.implementTask.mockResolvedValue({ ok: true, files: { 'a.ts': 'new' } })
    h.commitTaskWithPR.mockResolvedValue({ ok: false, reason: 'commit_push_failed' })
    const result = await resolveTask('owner::slug', TASK, 'slug')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/commit_push_failed/)
    expect(h.runCoverage).not.toHaveBeenCalled()
  })

  it('completes with a real PR + real coverage number on a full success', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
    h.implementTask.mockResolvedValue({ ok: true, files: { 'b.ts': 'new' } })
    h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/42', prNumber: 42 })
    h.runCoverage.mockResolvedValue({ coveragePercent: 91, testable: true, passed: true })

    const result = await resolveTask('owner::slug', TASK, 'slug')
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('completed')
    expect(result.prUrl).toBe('https://git.ainative.studio/pr/42')
    expect(result.coveragePercent).toBe(91)
    expect(h.updateTask).toHaveBeenLastCalledWith(
      'owner::slug', 't_abc123',
      { stage: 'completed', output: expect.stringContaining('https://git.ainative.studio/pr/42') },
    )
  })

  describe('#468 — auto-merge + redeploy on completion', () => {
    function setupSuccess() {
      h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1', workspaceId: 'workspace-1' })
      h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
      h.implementTask.mockResolvedValue({ ok: true, files: { 'b.ts': 'new' } })
      h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/42', prNumber: 42 })
      h.runCoverage.mockResolvedValue({ coveragePercent: 91, testable: true, passed: true })
    }

    it('merges the PR via mergeTaskPR(org, slug, prNumber) on a completed task', async () => {
      setupSuccess()
      h.mergeTaskPR.mockResolvedValue(true)
      const result = await resolveTask('owner::slug', TASK, 'slug')
      expect(h.mergeTaskPR).toHaveBeenCalledWith('ws-1', 'slug', 42)
      expect(result.merged).toBe(true)
    })

    it('never attempts to merge a FAILED task (below coverage floor)', async () => {
      h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
      h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
      h.implementTask.mockResolvedValue({ ok: true, files: { 'b.ts': 'new' } })
      h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/7', prNumber: 7 })
      h.runCoverage.mockResolvedValue({ coveragePercent: 55, testable: true, passed: true })

      const result = await resolveTask('owner::slug', TASK, 'slug')
      expect(result.stage).toBe('failed')
      expect(h.mergeTaskPR).not.toHaveBeenCalled()
    })

    it('redeploys after a successful merge when Railway deploy is enabled', async () => {
      setupSuccess()
      h.mergeTaskPR.mockResolvedValue(true)
      h.companyDeployEnabled.mockReturnValue(true)
      h.deployCompanyFromGitea.mockResolvedValue({ ok: true, serviceName: 'company-slug', url: 'https://slug.up.railway.app' })

      const result = await resolveTask('owner::slug', TASK, 'slug')
      expect(h.deployCompanyFromGitea).toHaveBeenCalledWith('workspace-1', 'slug', false)
      expect(h.setAppRailwayService).toHaveBeenCalledWith('slug', {
        railwayServiceId: 'company-slug',
        deployUrl: 'https://slug.up.railway.app',
      })
      expect(result.redeployed).toBe(true)
    })

    it('passes alreadyProvisioned=true (idempotent redeploy) when the company already has a railwayServiceId', async () => {
      h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1', workspaceId: 'workspace-1', railwayServiceId: 'company-slug' })
      h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
      h.implementTask.mockResolvedValue({ ok: true, files: { 'b.ts': 'new' } })
      h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/42', prNumber: 42 })
      h.runCoverage.mockResolvedValue({ coveragePercent: 91, testable: true, passed: true })
      h.mergeTaskPR.mockResolvedValue(true)
      h.companyDeployEnabled.mockReturnValue(true)
      h.deployCompanyFromGitea.mockResolvedValue({ ok: true, serviceName: 'company-slug' })

      await resolveTask('owner::slug', TASK, 'slug')
      expect(h.deployCompanyFromGitea).toHaveBeenCalledWith('workspace-1', 'slug', true)
    })

    it('falls back to BUILDER_WORKSPACE_ID when the company has no persisted workspaceId', async () => {
      h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
      h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
      h.implementTask.mockResolvedValue({ ok: true, files: { 'b.ts': 'new' } })
      h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/42', prNumber: 42 })
      h.runCoverage.mockResolvedValue({ coveragePercent: 91, testable: true, passed: true })
      h.mergeTaskPR.mockResolvedValue(true)
      h.companyDeployEnabled.mockReturnValue(true)
      h.deployCompanyFromGitea.mockResolvedValue({ ok: true, serviceName: 'company-slug' })

      await resolveTask('owner::slug', TASK, 'slug')
      expect(h.deployCompanyFromGitea).toHaveBeenCalledWith('builder-ws-default', 'slug', false)
    })

    it('does NOT redeploy when Railway deploy is disabled, even after a successful merge (cost-safe)', async () => {
      setupSuccess()
      h.mergeTaskPR.mockResolvedValue(true)
      h.companyDeployEnabled.mockReturnValue(false)

      const result = await resolveTask('owner::slug', TASK, 'slug')
      expect(h.deployCompanyFromGitea).not.toHaveBeenCalled()
      expect(result.redeployed).toBe(false)
    })

    it('does NOT redeploy when the merge itself fails (conflicts, checks pending)', async () => {
      setupSuccess()
      h.mergeTaskPR.mockResolvedValue(false)
      h.companyDeployEnabled.mockReturnValue(true)

      const result = await resolveTask('owner::slug', TASK, 'slug')
      expect(h.deployCompanyFromGitea).not.toHaveBeenCalled()
      expect(result.merged).toBe(false)
      expect(result.redeployed).toBe(false)
    })

    it('stays completed (never downgraded) when mergeTaskPR rejects', async () => {
      setupSuccess()
      h.mergeTaskPR.mockRejectedValue(new Error('gitea unreachable'))

      const result = await resolveTask('owner::slug', TASK, 'slug')
      expect(result.ok).toBe(true)
      expect(result.stage).toBe('completed')
      expect(result.merged).toBe(false)
    })

    it('stays completed (never downgraded) when deployCompanyFromGitea throws after a successful merge', async () => {
      setupSuccess()
      h.mergeTaskPR.mockResolvedValue(true)
      h.companyDeployEnabled.mockReturnValue(true)
      h.deployCompanyFromGitea.mockRejectedValue(new Error('railway CLI unavailable'))

      const result = await resolveTask('owner::slug', TASK, 'slug')
      expect(result.ok).toBe(true)
      expect(result.stage).toBe('completed')
      expect(result.merged).toBe(true)
      expect(result.redeployed).toBe(false)
    })

    it('records the merge outcome honestly in the task output', async () => {
      setupSuccess()
      h.mergeTaskPR.mockResolvedValue(true)
      h.companyDeployEnabled.mockReturnValue(true)
      h.deployCompanyFromGitea.mockResolvedValue({ ok: true, serviceName: 'company-slug' })

      await resolveTask('owner::slug', TASK, 'slug')
      expect(h.updateTask).toHaveBeenLastCalledWith(
        'owner::slug', 't_abc123',
        { stage: 'completed', output: expect.stringContaining('Merged to main and redeployed.') },
      )
    })

    it('records an honest "left open" note in the output when auto-merge fails', async () => {
      setupSuccess()
      h.mergeTaskPR.mockResolvedValue(false)

      await resolveTask('owner::slug', TASK, 'slug')
      expect(h.updateTask).toHaveBeenLastCalledWith(
        'owner::slug', 't_abc123',
        { stage: 'completed', output: expect.stringContaining('could not auto-merge') },
      )
    })
  })

  it('fails when the real coverage number is below the floor — even though the commit succeeded', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue({ 'a.ts': 'old' })
    h.implementTask.mockResolvedValue({ ok: true, files: { 'b.ts': 'new' } })
    h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/7' })
    h.runCoverage.mockResolvedValue({ coveragePercent: 55, testable: true, passed: true })

    const result = await resolveTask('owner::slug', TASK, 'slug')
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('failed')
    expect(result.reason).toMatch(/55%/)
  })

  it('runs coverage against the MERGED full tree (existing + changed), not just the diff', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue({ 'unchanged.ts': 'stays the same', 'changed.ts': 'old' })
    h.implementTask.mockResolvedValue({ ok: true, files: { 'changed.ts': 'new' } })
    h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/1' })
    h.runCoverage.mockResolvedValue({ coveragePercent: 90, testable: true, passed: true })

    await resolveTask('owner::slug', TASK, 'slug')
    const coverageArg = h.runCoverage.mock.calls[0][0]
    expect(coverageArg['unchanged.ts']).toBe('stays the same')
    expect(coverageArg['changed.ts']).toBe('new') // the CHANGED version, not the old one
  })

  it('accepts a genuinely untestable app on implementation alone (matches core issue_resolution_loop.py principle)', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.fetchRepoFiles.mockResolvedValue({})
    h.implementTask.mockResolvedValue({ ok: true, files: { 'a.ts': 'x' } })
    h.commitTaskWithPR.mockResolvedValue({ ok: true, prUrl: 'https://git.ainative.studio/pr/1' })
    h.runCoverage.mockResolvedValue({ coveragePercent: null, testable: false, passed: false })

    const result = await resolveTask('owner::slug', TASK, 'slug')
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('completed')
  })
})
