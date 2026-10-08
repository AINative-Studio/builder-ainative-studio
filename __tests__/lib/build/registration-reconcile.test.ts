import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1015 — server-side reconciliation for companies whose browser died before
 * Preview.tsx's register-app effect ever fired.
 *
 * The live case this is built from: company "Flo" has real deployment-health
 * stages `generate: ok` and `register: ok`, and NO `ready_check` / `git_commit`
 * rows at all — proof that register-app (the only place those two stages are
 * reported from) never ran for it server-side. Its live page renders nothing of
 * the founder's actual idea.
 *
 * The three properties these tests pin down, per the issue's own framing:
 *  1. A company with `register: ok` but no ready_check/git_commit is re-driven
 *     through the real gate + commit, using the founder's OWN stored registry
 *     data (name/chatId), never re-asked from a client.
 *  2. An already-complete company is a strict no-op — idempotent, so the sweep
 *     can run on a schedule without re-committing anyone's code.
 *  3. A company that was never generated at all is LEFT ALONE. That is a
 *     different failure, and inventing a registration for it would be worse
 *     than the bug being fixed.
 */

const listAllAppsWithStatus = vi.fn()
const resolveApp = vi.fn()
const fetchDeploymentHealthStages = vi.fn()
const classifyRegistrationHealth = vi.fn()
const runReadyGate = vi.fn()
const runGitCommit = vi.fn()

vi.mock('@/lib/build/app-registry', () => ({
  listAllAppsWithStatus: (...a: unknown[]) => listAllAppsWithStatus(...a),
  resolveApp: (...a: unknown[]) => resolveApp(...a),
}))
vi.mock('@/lib/build/deployment-health', () => ({
  fetchDeploymentHealthStages: (...a: unknown[]) => fetchDeploymentHealthStages(...a),
  classifyRegistrationHealth: (...a: unknown[]) => classifyRegistrationHealth(...a),
}))
vi.mock('@/lib/build/register-app-core', () => ({
  runReadyGate: (...a: unknown[]) => runReadyGate(...a),
  runGitCommit: (...a: unknown[]) => runGitCommit(...a),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  reconcileRegistration,
  runRegistrationReconcileSweep,
  MAX_RECONCILES_PER_RUN,
} from '@/lib/build/registration-reconcile'

const FLO = {
  slug: 'flo',
  chatId: 'chat_flo',
  name: 'Flo',
  tagline: 'financial coaching',
  idea: 'cash-flow forecasting and expense tracking',
  ownerEmail: 'admin@ainative.studio',
  gitRepoId: '42',
  zerodbProjectId: 'proj_flo',
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveApp.mockResolvedValue(FLO)
  fetchDeploymentHealthStages.mockResolvedValue({ ok: true, stages: [] })
  classifyRegistrationHealth.mockReturnValue('stuck')
  runReadyGate.mockResolvedValue({ ready: { checked: true, ok: true }, blocked: false })
  runGitCommit.mockResolvedValue({ attempted: true, committed: true })
})

describe('reconcileRegistration — the stuck "Flo" class', () => {
  it('re-drives the real ready gate and git commit using the company STORED registry data', async () => {
    const res = await reconcileRegistration('flo')

    expect(res.disposition).toBe('stuck')
    expect(res.reconciled).toBe(true)
    // The chatId comes from the registry row, NOT from any client payload.
    expect(runReadyGate).toHaveBeenCalledWith('flo', 'chat_flo')
    expect(runGitCommit).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'flo', chatId: 'chat_flo', existing: FLO }),
    )
    expect(res.readyChecked).toBe(true)
    expect(res.gitCommitted).toBe(true)
  })

  it('reads the stages from the SAME core endpoint the live diagnosis used', async () => {
    await reconcileRegistration('flo')
    expect(fetchDeploymentHealthStages).toHaveBeenCalledWith('builder_app_generation', 'flo')
  })

  it('labels the commit as a reconciliation so the git history is honest about its origin', async () => {
    await reconcileRegistration('flo')
    const [opts] = runGitCommit.mock.calls[0]
    expect(String(opts.taskLabel)).toMatch(/reconcil/i)
  })

  it('does NOT commit when the re-run gate proves the app is genuinely broken', async () => {
    runReadyGate.mockResolvedValue({
      ready: { checked: true, ok: false, reason: 'parse_error' },
      blocked: true,
    })

    const res = await reconcileRegistration('flo')

    expect(runGitCommit).not.toHaveBeenCalled()
    expect(res.reconciled).toBe(false)
    expect(res.reason).toBe('ready_gate_blocked')
  })

  it('dry-run touches nothing real but still reports the company as a candidate', async () => {
    const res = await reconcileRegistration('flo', { dryRun: true })

    expect(runReadyGate).not.toHaveBeenCalled()
    expect(runGitCommit).not.toHaveBeenCalled()
    expect(res.disposition).toBe('stuck')
    expect(res.reconciled).toBe(false)
    expect(res.reason).toBe('dry_run')
  })
})

describe('reconcileRegistration — idempotency and leaving the wrong cases alone', () => {
  it('is a strict NO-OP for an already fully-registered company', async () => {
    classifyRegistrationHealth.mockReturnValue('complete')

    const res = await reconcileRegistration('flo')

    expect(runReadyGate).not.toHaveBeenCalled()
    expect(runGitCommit).not.toHaveBeenCalled()
    expect(res.reconciled).toBe(false)
    expect(res.disposition).toBe('complete')
  })

  it('leaves a company that was NEVER GENERATED alone — not this bug class', async () => {
    classifyRegistrationHealth.mockReturnValue('never_generated')

    const res = await reconcileRegistration('flo')

    expect(runReadyGate).not.toHaveBeenCalled()
    expect(runGitCommit).not.toHaveBeenCalled()
    expect(res.reconciled).toBe(false)
    expect(res.disposition).toBe('never_generated')
  })

  it('leaves a company whose generation itself FAILED alone', async () => {
    classifyRegistrationHealth.mockReturnValue('generation_failed')

    const res = await reconcileRegistration('flo')

    expect(runReadyGate).not.toHaveBeenCalled()
    expect(res.reconciled).toBe(false)
  })

  it('leaves a company the gate already REJECTED alone — repair is a different path', async () => {
    classifyRegistrationHealth.mockReturnValue('ready_check_failed')

    const res = await reconcileRegistration('flo')

    expect(runReadyGate).not.toHaveBeenCalled()
    expect(res.reconciled).toBe(false)
  })

  it('FAILS CLOSED when the stage read could not be verified — never re-drives on a blind guess', async () => {
    fetchDeploymentHealthStages.mockResolvedValue({ ok: false, stages: [] })
    classifyRegistrationHealth.mockReturnValue('unverifiable')

    const res = await reconcileRegistration('flo')

    expect(runReadyGate).not.toHaveBeenCalled()
    expect(res.reconciled).toBe(false)
    expect(res.disposition).toBe('unverifiable')
  })

  it('does nothing for a slug with no registry row at all', async () => {
    resolveApp.mockResolvedValue(null)

    const res = await reconcileRegistration('ghost')

    expect(fetchDeploymentHealthStages).not.toHaveBeenCalled()
    expect(runReadyGate).not.toHaveBeenCalled()
    expect(res.reason).toBe('no_registry_entry')
  })

  it('does nothing for a registry row with no chatId — there is no generation to verify', async () => {
    resolveApp.mockResolvedValue({ ...FLO, chatId: '' })

    const res = await reconcileRegistration('flo')

    expect(runReadyGate).not.toHaveBeenCalled()
    expect(res.reason).toBe('no_chat_id')
  })

  it('never throws — a reconciliation hiccup must not surface to the founder', async () => {
    resolveApp.mockRejectedValue(new Error('registry down'))

    await expect(reconcileRegistration('flo')).resolves.toMatchObject({ reconciled: false })
  })
})

describe('runRegistrationReconcileSweep', () => {
  function app(slug: string, extra: Record<string, unknown> = {}) {
    return { slug, chatId: `chat_${slug}`, name: slug, ...extra }
  }

  it('defaults to a DRY RUN so a cron ping or probe can never re-drive real companies', async () => {
    listAllAppsWithStatus.mockResolvedValue({ apps: [app('flo')], ok: true })

    const res = await runRegistrationReconcileSweep()

    expect(res.dryRun).toBe(true)
    expect(runGitCommit).not.toHaveBeenCalled()
    expect(res.candidates).toBe(1)
    expect(res.reconciled).toBe(0)
  })

  it('reconciles only the stuck companies on a real run and reports honest counts', async () => {
    listAllAppsWithStatus.mockResolvedValue({
      apps: [app('flo'), app('healthy'), app('nevergen')],
      ok: true,
    })
    resolveApp.mockImplementation(async (slug: string) => app(slug, { gitRepoId: '1' }))
    classifyRegistrationHealth.mockImplementation((read: { stages: { stage: string }[] }) => {
      const names = read.stages.map((s) => s.stage)
      if (names.includes('ready_check')) return 'complete'
      if (names.includes('generate')) return 'stuck'
      return 'never_generated'
    })
    fetchDeploymentHealthStages.mockImplementation(async (_t: string, slug: string) => {
      if (slug === 'flo') return { ok: true, stages: [{ stage: 'generate' }, { stage: 'register' }] }
      if (slug === 'healthy') return { ok: true, stages: [{ stage: 'generate' }, { stage: 'ready_check' }] }
      return { ok: true, stages: [] }
    })

    const res = await runRegistrationReconcileSweep({ dryRun: false })

    expect(res.total).toBe(3)
    expect(res.candidates).toBe(1)
    expect(res.reconciled).toBe(1)
    expect(runGitCommit).toHaveBeenCalledTimes(1)
    expect(runGitCommit.mock.calls[0][0]).toMatchObject({ slug: 'flo' })
    expect(res.byDisposition).toMatchObject({ stuck: 1, complete: 1, never_generated: 1 })
  })

  it('reports registryOk:false and does nothing when the registry read fails — an outage is not an empty platform', async () => {
    listAllAppsWithStatus.mockResolvedValue({ apps: [], ok: false })

    const res = await runRegistrationReconcileSweep({ dryRun: false })

    expect(res.registryOk).toBe(false)
    expect(res.total).toBe(0)
    expect(fetchDeploymentHealthStages).not.toHaveBeenCalled()
  })

  it('skips soft-deleted companies entirely', async () => {
    listAllAppsWithStatus.mockResolvedValue({
      apps: [app('flo', { lifecycleStatus: 'deleted' })],
      ok: true,
    })

    const res = await runRegistrationReconcileSweep({ dryRun: false })

    expect(res.total).toBe(0)
    expect(fetchDeploymentHealthStages).not.toHaveBeenCalled()
  })

  it('caps real reconciliations per run so a filter bug cannot burst across the platform', async () => {
    const many = Array.from({ length: MAX_RECONCILES_PER_RUN + 3 }, (_, i) => app(`c${i}`))
    listAllAppsWithStatus.mockResolvedValue({ apps: many, ok: true })
    resolveApp.mockImplementation(async (slug: string) => app(slug, { gitRepoId: '1' }))

    const res = await runRegistrationReconcileSweep({ dryRun: false })

    expect(res.reconciled).toBe(MAX_RECONCILES_PER_RUN)
    expect(runGitCommit).toHaveBeenCalledTimes(MAX_RECONCILES_PER_RUN)
    expect(res.results.filter((r) => r.reason === 'run_cap_reached')).toHaveLength(3)
  })

  it('can target a single slug, so a dashboard load can reconcile just that company', async () => {
    const res = await runRegistrationReconcileSweep({ dryRun: false, slug: 'flo' })

    expect(listAllAppsWithStatus).not.toHaveBeenCalled()
    expect(res.total).toBe(1)
    expect(res.reconciled).toBe(1)
    expect(runGitCommit).toHaveBeenCalledTimes(1)
  })

  it('counts a per-company failure as failed without aborting the rest of the sweep', async () => {
    listAllAppsWithStatus.mockResolvedValue({ apps: [app('bad'), app('good')], ok: true })
    resolveApp.mockImplementation(async (slug: string) => app(slug, { gitRepoId: '1' }))
    runGitCommit.mockImplementation(async (o: { slug: string }) =>
      o.slug === 'bad' ? { attempted: true, committed: false } : { attempted: true, committed: true },
    )

    const res = await runRegistrationReconcileSweep({ dryRun: false })

    expect(res.candidates).toBe(2)
    expect(res.reconciled).toBe(2)
    expect(res.results.find((r) => r.slug === 'bad')?.gitCommitted).toBe(false)
    expect(res.results.find((r) => r.slug === 'good')?.gitCommitted).toBe(true)
  })
})
