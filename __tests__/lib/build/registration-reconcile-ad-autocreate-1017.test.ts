import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1017 — the ad-test auto-create hook on the #1015 reconciliation path.
 *
 * #1015's sweep is the OTHER place a build becomes "genuinely complete": a
 * company whose browser died mid-generation gets its real ready gate + git
 * commit re-driven server-side. That company is exactly as finished as one that
 * completed in the browser, so it must get the same auto-created PAUSED
 * campaign — otherwise the feature would only ever reach founders whose tab
 * happened to stay open.
 *
 * The invariants this pins down:
 *  - fires only on a REAL reconciliation (gate reached a verdict / commit
 *    attempted), never on a dry run, never on a company left alone;
 *  - never fires for a company the gate proved broken;
 *  - never fires for a company with no stored code left (the unrecoverable case);
 *  - never throws / never changes the reconciliation's own reported outcome.
 */

const listAllAppsWithStatus = vi.fn()
/**
 * The real registry read reconcileRegistration performs (#1494 — swapped from
 * the ambiguous resolveApp()). `resolveAppVerified` below is the mock the
 * module actually imports; `resolveApp` stays as the test-local handle for the
 * CONFIRMED answers (a real entry, or a real "no such company"), so the
 * existing cases read unchanged. The UNVERIFIED third shape is set on
 * `resolveAppVerified` directly at its own use sites.
 */
const resolveApp = vi.fn()
const resolveAppVerified = vi.fn(async (...a: unknown[]) => ({
  entry: await resolveApp(...a),
  verified: true,
}))
const fetchDeploymentHealthStages = vi.fn()
const classifyRegistrationHealth = vi.fn()
const reportDeploymentHealthStage = vi.fn()
const runReadyGate = vi.fn()
const runGitCommit = vi.fn()
const autoCreateAdTestCampaign = vi.fn()

vi.mock('@/lib/build/app-registry', () => ({
  listAllAppsWithStatus: (...a: unknown[]) => listAllAppsWithStatus(...a),
  resolveAppVerified: (...a: unknown[]) => resolveAppVerified(...a),
}))
vi.mock('@/lib/build/deployment-health', () => ({
  fetchDeploymentHealthStages: (...a: unknown[]) => fetchDeploymentHealthStages(...a),
  classifyRegistrationHealth: (...a: unknown[]) => classifyRegistrationHealth(...a),
  reportDeploymentHealthStage: (...a: unknown[]) => reportDeploymentHealthStage(...a),
}))
vi.mock('@/lib/build/register-app-core', () => ({
  runReadyGate: (...a: unknown[]) => runReadyGate(...a),
  runGitCommit: (...a: unknown[]) => runGitCommit(...a),
}))
vi.mock('@/lib/build/ad-test-autocreate', () => ({
  autoCreateAdTestCampaign: (...a: unknown[]) => autoCreateAdTestCampaign(...a),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { reconcileRegistration } from '@/lib/build/registration-reconcile'

const FLO = {
  slug: 'flo',
  chatId: 'chat_flo',
  name: 'Flo',
  tagline: 'financial coaching',
  gitRepoId: '42',
  zerodbProjectId: 'proj_flo',
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveAppVerified.mockImplementation(async (...a: unknown[]) => ({
    entry: await resolveApp(...a),
    verified: true,
  }))
  resolveApp.mockResolvedValue(FLO)
  fetchDeploymentHealthStages.mockResolvedValue({ ok: true, stages: [] })
  classifyRegistrationHealth.mockReturnValue('stuck')
  runReadyGate.mockResolvedValue({ ready: { checked: true, ok: true }, blocked: false })
  runGitCommit.mockResolvedValue({ attempted: true, committed: true })
  autoCreateAdTestCampaign.mockResolvedValue({ created: true, campaignId: 'camp_auto_1' })
})

describe('reconcileRegistration — ad-test auto-create (#1017)', () => {
  it('auto-creates the PAUSED campaign after a real reconciliation completes the build', async () => {
    const res = await reconcileRegistration('flo')
    expect(res.reconciled).toBe(true)
    expect(autoCreateAdTestCampaign).toHaveBeenCalledWith('flo')
  })

  it('does NOT auto-create on a dry run (nothing was actually completed)', async () => {
    const res = await reconcileRegistration('flo', { dryRun: true })
    expect(res.reconciled).toBe(false)
    expect(autoCreateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('does NOT auto-create for a company left alone (already complete)', async () => {
    classifyRegistrationHealth.mockReturnValue('complete')
    await reconcileRegistration('flo')
    expect(autoCreateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('does NOT auto-create when the gate proved the app broken', async () => {
    runReadyGate.mockResolvedValue({ ready: { checked: true, ok: false, reason: 'syntax' }, blocked: true })
    const res = await reconcileRegistration('flo')
    expect(res.reason).toBe('ready_gate_blocked')
    expect(autoCreateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('does NOT auto-create for the unrecoverable no-stored-code case', async () => {
    runReadyGate.mockResolvedValue({ ready: { checked: false, ok: true }, blocked: false })
    runGitCommit.mockResolvedValue({ attempted: false, committed: false })
    const res = await reconcileRegistration('flo')
    expect(res.reason).toBe('no_stored_code')
    expect(autoCreateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('still reports a successful reconciliation when auto-create rejects', async () => {
    autoCreateAdTestCampaign.mockRejectedValue(new Error('meta down'))
    const res = await reconcileRegistration('flo')
    expect(res.reconciled).toBe(true)
    expect(res.gitCommitted).toBe(true)
    expect(res.reason).toBeUndefined()
  })
})
