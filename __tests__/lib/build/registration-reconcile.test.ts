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
const reportDeploymentHealthStage = vi.fn()
const runReadyGate = vi.fn()
const runGitCommit = vi.fn()

vi.mock('@/lib/build/app-registry', () => ({
  listAllAppsWithStatus: (...a: unknown[]) => listAllAppsWithStatus(...a),
  resolveApp: (...a: unknown[]) => resolveApp(...a),
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

/**
 * The code-review finding this pins down (HIGH): a stuck company whose generated
 * code is no longer resolvable at all.
 *
 * The in-memory preview store is PROCESS-LOCAL (lib/preview-store.ts), so a
 * browser that died mid-generation may never have landed a durable ZeroDB copy.
 * For such a company the gate returns { checked: false, ok: true } (fail-open,
 * reporting NO stage) and toFileMapForCommit(null) is falsy so the commit
 * reports attempted:false — ALSO no stage. Nothing was written, so the company's
 * stage set is byte-identical to before the run and classifyRegistrationHealth
 * calls it `stuck` again on the very next sweep. Forever.
 *
 * Reporting `reconciled: true` there is exactly the fabricated-success the rest
 * of this module is careful to avoid (cf. fetchDeploymentHealthStages' deliberate
 * ok:false vs. genuinely-empty distinction). It must be reported as unresolved,
 * AND a terminal stage must be recorded so the company stops being re-swept.
 */
describe('reconcileRegistration — code genuinely unrecoverable (no stored code)', () => {
  beforeEach(() => {
    // The real shape: gate could not verify anything (fail-open, no stage
    // reported) and the commit never attempted anything (no file map).
    runReadyGate.mockResolvedValue({ ready: { checked: false, ok: true }, blocked: false })
    runGitCommit.mockResolvedValue({ attempted: false, committed: false })
  })

  it('does NOT claim reconciled:true when neither the gate nor the commit did anything real', async () => {
    const res = await reconcileRegistration('flo')

    expect(res.reconciled).toBe(false)
    expect(res.readyChecked).toBe(false)
    expect(res.gitCommitted).toBe(false)
  })

  it('reports the real reason so the sweep counters distinguish this from a success', async () => {
    const res = await reconcileRegistration('flo')
    expect(res.reason).toBe('no_stored_code')
  })

  it('records a terminal ready_check:skipped stage so the company classifies OUT of stuck next run', async () => {
    await reconcileRegistration('flo')

    expect(reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'flo', 'ready_check', 'skipped', 'no_stored_code',
    )
  })

  it('still counts as reconciled when the gate was unverifiable but a real commit DID land', async () => {
    // An unverifiable gate alone is not proof the code is gone — the durable
    // store can answer the commit path even when the parse gate fails open.
    runGitCommit.mockResolvedValue({ attempted: true, committed: true })

    const res = await reconcileRegistration('flo')

    expect(res.reconciled).toBe(true)
    expect(res.gitCommitted).toBe(true)
    expect(reportDeploymentHealthStage).not.toHaveBeenCalled()
  })

  it('still counts as reconciled when the gate verified the app but the company has nowhere to commit', async () => {
    // A free, unprovisioned company legitimately has no repo. The gate reported
    // a real ready_check:ok, so genuine progress was made.
    runReadyGate.mockResolvedValue({ ready: { checked: true, ok: true }, blocked: false })

    const res = await reconcileRegistration('flo')

    expect(res.reconciled).toBe(true)
    expect(res.readyChecked).toBe(true)
    expect(reportDeploymentHealthStage).not.toHaveBeenCalled()
  })

  it('counts an unresolvable company as a SKIP, not a success, in the sweep totals', async () => {
    listAllAppsWithStatus.mockResolvedValue({ apps: [{ slug: 'flo', chatId: 'chat_flo' }], ok: true })

    const res = await runRegistrationReconcileSweep({ dryRun: false })

    expect(res.candidates).toBe(1)
    expect(res.reconciled).toBe(0)
    expect(res.skipped).toBe(1)
    expect(res.results[0].reason).toBe('no_stored_code')
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

  /**
   * Code-review finding (MEDIUM): the sweep's READ pass is unbounded.
   *
   * MAX_RECONCILES_PER_RUN caps WRITES, but every live company (~162 in
   * production) still costs a sequential resolveApp + fetchDeploymentHealthStages,
   * each with a 15s timeout. That read pass is where the time goes, and the cron
   * route's maxDuration is 300s. A sweep that overruns is killed mid-iteration:
   * nothing is persisted, the response never returns, and the next run restarts
   * from the top of the SAME iteration order — so companies late in that order can
   * starve indefinitely while the early ones are re-read every time.
   *
   * The fix is a wall-clock budget: stop iterating with headroom under the ceiling
   * and return what was genuinely completed, flagged truncated with a real
   * remaining count — never a silent partial reported as a whole-platform sweep.
   */
  describe('wall-clock deadline', () => {
    it('stops iterating once the time budget is spent and reports the truncation honestly', async () => {
      listAllAppsWithStatus.mockResolvedValue({
        apps: [app('a'), app('b'), app('c'), app('d')],
        ok: true,
      })
      // Each company "costs" 100ms of wall clock against a 150ms budget. The
      // deadline is checked BEFORE each company (so the budget's headroom covers
      // finishing the in-flight one), meaning a and b run — after b the clock
      // reads 200ms, which is past 150ms — and c and d are left for the next run.
      let now = 0
      fetchDeploymentHealthStages.mockImplementation(async () => {
        now += 100
        return { ok: true, stages: [{ stage: 'generate' }] }
      })

      const res = await runRegistrationReconcileSweep({
        dryRun: true,
        budgetMs: 150,
        now: () => now,
      })

      expect(res.truncated).toBe(true)
      expect(res.remaining).toBe(2)
      expect(res.results).toHaveLength(2)
      // `total` stays the real live-company count — the sweep must not pretend the
      // platform only has as many companies as it managed to reach.
      expect(res.total).toBe(4)
      expect(fetchDeploymentHealthStages).toHaveBeenCalledTimes(2)
    })

    it('reports truncated:false and remaining:0 when the whole registry fits in the budget', async () => {
      listAllAppsWithStatus.mockResolvedValue({ apps: [app('a'), app('b')], ok: true })

      const res = await runRegistrationReconcileSweep({ dryRun: true })

      expect(res.truncated).toBe(false)
      expect(res.remaining).toBe(0)
      expect(res.results).toHaveLength(2)
    })

    it('always makes progress on at least one company, even with a budget already spent', async () => {
      // A pathologically small/elapsed budget must not produce a sweep that does
      // nothing forever — that would be the starvation this fix exists to prevent.
      listAllAppsWithStatus.mockResolvedValue({ apps: [app('a'), app('b')], ok: true })

      const res = await runRegistrationReconcileSweep({
        dryRun: true,
        budgetMs: 0,
        now: () => 10_000,
      })

      expect(res.results).toHaveLength(1)
      expect(res.truncated).toBe(true)
      expect(res.remaining).toBe(1)
    })
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
