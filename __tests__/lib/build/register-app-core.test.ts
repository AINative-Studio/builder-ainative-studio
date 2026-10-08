import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1015 — the ready-gate + git-commit half of register-app, extracted so a
 * SERVER-SIDE reconciliation pass can run the identical logic.
 *
 * Why an extraction rather than an internal fetch back into the route: the two
 * things actually missing for a stuck company are the ready gate and the git
 * commit, and the route's POST handler does considerably more — notably an
 * unconditional, un-deduped `registerApp()` append against a registry read with a
 * hard `?limit=1000` cap, which a recurring sweep would burn for nothing; and a
 * self-fetch would have to cross the middleware boundary with an absolute origin
 * URL. The gate and the commit are the two things this module owns, and both the
 * route and the reconciler call it, so they can never drift. (The `{slug}-2`
 * auto-suffix and a re-fired welcome email are NOT hazards on this path — see
 * lib/build/register-app-core.ts's header for why each is unreachable.)
 */

const checkAppReady = vi.fn()
const resolveStoredApp = vi.fn()
const commitRegeneration = vi.fn()
const provisionCompanyRepo = vi.fn()
const toFileMapForCommit = vi.fn()
const reportDeploymentHealthStage = vi.fn()

vi.mock('@/lib/build/ready-gate', () => ({
  checkAppReady: (...a: unknown[]) => checkAppReady(...a),
  resolveStoredApp: (...a: unknown[]) => resolveStoredApp(...a),
}))
vi.mock('@/lib/git/company-repo', () => ({
  commitRegeneration: (...a: unknown[]) => commitRegeneration(...a),
  provisionCompanyRepo: (...a: unknown[]) => provisionCompanyRepo(...a),
  toFileMapForCommit: (...a: unknown[]) => toFileMapForCommit(...a),
}))
vi.mock('@/lib/build/deployment-health', () => ({
  reportDeploymentHealthStage: (...a: unknown[]) => reportDeploymentHealthStage(...a),
}))

import { runReadyGate, runGitCommit } from '@/lib/build/register-app-core'

beforeEach(() => {
  vi.clearAllMocks()
  reportDeploymentHealthStage.mockResolvedValue(undefined)
})

describe('runReadyGate', () => {
  it('reports a ready_check:ok stage and allows the pipeline through on a passing gate', async () => {
    checkAppReady.mockResolvedValue({ checked: true, ok: true })

    const res = await runReadyGate('my-slug', 'chat_1')

    expect(res.blocked).toBe(false)
    expect(res.ready.checked).toBe(true)
    expect(reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'my-slug', 'ready_check', 'ok',
    )
  })

  it('reports ready_check:failed with the real reason and BLOCKS on a proven-broken app', async () => {
    checkAppReady.mockResolvedValue({ checked: true, ok: false, reason: 'parse_error', error: 'Unexpected token' })

    const res = await runReadyGate('my-slug', 'chat_1')

    expect(res.blocked).toBe(true)
    expect(res.ready.reason).toBe('parse_error')
    expect(reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'my-slug', 'ready_check', 'failed', 'parse_error',
    )
  })

  it('retries an unverifiable gate up to 3 extra times before accepting it (the aerosol store-miss race)', async () => {
    checkAppReady.mockResolvedValue({ checked: false, ok: true })

    const res = await runReadyGate('my-slug', 'chat_1', { retryDelayMs: 0 })

    expect(checkAppReady).toHaveBeenCalledTimes(4)
    expect(res.blocked).toBe(false)
    expect(res.ready.checked).toBe(false)
  })

  it('stops retrying as soon as the gate becomes verifiable', async () => {
    checkAppReady
      .mockResolvedValueOnce({ checked: false, ok: true })
      .mockResolvedValueOnce({ checked: true, ok: true })

    await runReadyGate('my-slug', 'chat_1', { retryDelayMs: 0 })

    expect(checkAppReady).toHaveBeenCalledTimes(2)
  })

  it('reports NO ready_check stage at all when the gate could not verify — never a fabricated ok', async () => {
    checkAppReady.mockResolvedValue({ checked: false, ok: true })

    await runReadyGate('my-slug', 'chat_1', { retryDelayMs: 0 })

    expect(reportDeploymentHealthStage).not.toHaveBeenCalled()
  })

  it('fails OPEN (never blocks) when checkAppReady itself throws', async () => {
    checkAppReady.mockRejectedValue(new Error('store exploded'))

    const res = await runReadyGate('my-slug', 'chat_1', { retryDelayMs: 0 })

    expect(res.blocked).toBe(false)
  })
})

describe('runGitCommit', () => {
  it('commits a regeneration against an EXISTING repo and reports git_commit:ok', async () => {
    resolveStoredApp.mockResolvedValue({ code: 'x', files: null })
    toFileMapForCommit.mockReturnValue({ 'App.tsx': 'x' })
    commitRegeneration.mockResolvedValue(true)

    const res = await runGitCommit({
      slug: 'my-slug',
      chatId: 'chat_1',
      existing: { gitRepoId: '42' },
      taskLabel: 'reconciliation',
    })

    expect(commitRegeneration).toHaveBeenCalledWith({
      slug: 'my-slug', files: { 'App.tsx': 'x' }, taskLabel: 'reconciliation',
    })
    expect(provisionCompanyRepo).not.toHaveBeenCalled()
    expect(res).toEqual({ attempted: true, committed: true })
    expect(reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'my-slug', 'git_commit', 'ok',
    )
  })

  it('provisions a NEW repo for a provisioned company that has none yet', async () => {
    resolveStoredApp.mockResolvedValue({ code: 'x', files: null })
    toFileMapForCommit.mockReturnValue({ 'App.tsx': 'x' })
    provisionCompanyRepo.mockResolvedValue({ ok: true })

    const res = await runGitCommit({
      slug: 'my-slug',
      chatId: 'chat_1',
      existing: { zerodbProjectId: 'proj_1' },
    })

    expect(provisionCompanyRepo).toHaveBeenCalled()
    expect(commitRegeneration).not.toHaveBeenCalled()
    expect(res).toEqual({ attempted: true, committed: true })
  })

  it('does NOT attempt (and reports no stage) for a company with neither a repo nor a project', async () => {
    resolveStoredApp.mockResolvedValue({ code: 'x', files: null })
    toFileMapForCommit.mockReturnValue({ 'App.tsx': 'x' })

    const res = await runGitCommit({ slug: 'my-slug', chatId: 'chat_1', existing: {} })

    expect(res).toEqual({ attempted: false, committed: false })
    expect(reportDeploymentHealthStage).not.toHaveBeenCalled()
  })

  it('does NOT attempt when there is genuinely no code to commit', async () => {
    resolveStoredApp.mockResolvedValue(null)
    toFileMapForCommit.mockReturnValue(null)

    const res = await runGitCommit({ slug: 'my-slug', chatId: 'chat_1', existing: { gitRepoId: '42' } })

    expect(res).toEqual({ attempted: false, committed: false })
    expect(commitRegeneration).not.toHaveBeenCalled()
  })

  it('reports git_commit:failed — never a fabricated success — when the commit returns false', async () => {
    resolveStoredApp.mockResolvedValue({ code: 'x', files: null })
    toFileMapForCommit.mockReturnValue({ 'App.tsx': 'x' })
    commitRegeneration.mockResolvedValue(false)

    const res = await runGitCommit({ slug: 'my-slug', chatId: 'chat_1', existing: { gitRepoId: '42' } })

    expect(res).toEqual({ attempted: true, committed: false })
    expect(reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'my-slug', 'git_commit', 'failed',
    )
  })

  it('counts a thrown commit as an attempted failure and never propagates the throw', async () => {
    resolveStoredApp.mockResolvedValue({ code: 'x', files: null })
    toFileMapForCommit.mockReturnValue({ 'App.tsx': 'x' })
    commitRegeneration.mockRejectedValue(new Error('gitea down'))

    const res = await runGitCommit({ slug: 'my-slug', chatId: 'chat_1', existing: { gitRepoId: '42' } })

    expect(res).toEqual({ attempted: true, committed: false })
    expect(reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'my-slug', 'git_commit', 'failed',
    )
  })
})
