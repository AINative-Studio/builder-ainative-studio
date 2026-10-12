import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1032 — backfill sweep for founders who are genuinely paid in core but
 * whose Builder registry row never got `plan` stamped (null/stale).
 *
 * Amador (amador@selfpreneur.com, company `agentive`) was the confirmed live
 * case: core answered `"plan":"pro"`, the registry had `plan: null`, and he
 * was fixed by hand via `setAppPlan('agentive', 'pro')`. These tests pin the
 * safety contract for the SWEEP version of that same check, since a real run
 * writes to live customer registry rows:
 *   - dry run NEVER calls setAppPlan,
 *   - a real run fixes ONLY a confirmed mismatch (core says paid, registry
 *     doesn't),
 *   - an unverifiable core lookup is skipped, never guessed at (fail closed),
 *   - a company already correctly paid in the registry is left alone (no
 *     churn write, no unnecessary core call),
 *   - a genuinely unpaid account (Greg Rose's case) is never "fixed".
 */

const h = vi.hoisted(() => ({
  listAllAppsWithStatus: vi.fn() as ReturnType<typeof vi.fn>,
  setAppPlan: vi.fn(async (_slug: string, _plan: string): Promise<boolean> => true),
  fetchPlanByEmail: vi.fn() as ReturnType<typeof vi.fn>,
}))

vi.mock('@/lib/build/app-registry', () => ({
  listAllAppsWithStatus: h.listAllAppsWithStatus,
  setAppPlan: h.setAppPlan,
}))
vi.mock('@/lib/ainative/admin-plan-lookup', () => ({
  fetchPlanByEmail: h.fetchPlanByEmail,
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runPaidFounderPlanBackfillSweep, classifyFounderPlanState } from '@/lib/build/paid-founder-plan-backfill'

const app = (slug: string, ownerEmail?: string, plan?: string | null, extra: Record<string, unknown> = {}) => ({
  slug, chatId: `chat-${slug}`, name: slug, ownerEmail, plan, ...extra,
})

const verified = (plan: string) => ({ plan, email: 'x@y.com', verified: true })
const unverified = (reason: string) => ({ plan: null, email: null, verified: false, reason })

beforeEach(() => {
  vi.clearAllMocks()
  h.setAppPlan.mockResolvedValue(true)
  h.listAllAppsWithStatus.mockResolvedValue({ apps: [], ok: true })
})

describe('#1032 classifyFounderPlanState — the pure safety gate', () => {
  it('flags a mismatch only when core confirms paid AND the registry is not already paid', () => {
    expect(classifyFounderPlanState({
      hasOwnerEmail: true, registryPlanIsPaid: false, planVerified: true, corePlanIsPaid: true,
    })).toBe('mismatch')
  })

  it('never flags a mismatch when the registry already reflects a paid tier', () => {
    expect(classifyFounderPlanState({
      hasOwnerEmail: true, registryPlanIsPaid: true, planVerified: true, corePlanIsPaid: true,
    })).toBe('already_paid_in_registry')
  })

  it('FAILS CLOSED when the core plan could not be verified — never treats it as a mismatch', () => {
    expect(classifyFounderPlanState({
      hasOwnerEmail: true, registryPlanIsPaid: false, planVerified: false, corePlanIsPaid: true,
    })).toBe('unverifiable')
  })

  it('reports a genuinely unpaid account as confirmed_unpaid, not a mismatch (Greg Rose\'s case)', () => {
    expect(classifyFounderPlanState({
      hasOwnerEmail: true, registryPlanIsPaid: false, planVerified: true, corePlanIsPaid: false,
    })).toBe('confirmed_unpaid')
  })

  it('skips an anonymous company with no owner to attribute a plan to', () => {
    expect(classifyFounderPlanState({
      hasOwnerEmail: false, registryPlanIsPaid: false, planVerified: true, corePlanIsPaid: true,
    })).toBe('no_owner_email')
  })
})

describe('#1032 runPaidFounderPlanBackfillSweep — dry run never writes', () => {
  it('reports a confirmed mismatch as a candidate but never calls setAppPlan', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('agentive', 'amador@selfpreneur.com', null)], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('pro'))

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: true })

    expect(r.dryRun).toBe(true)
    expect(r.mismatches).toBe(1)
    expect(r.fixed).toBe(0)
    expect(h.setAppPlan).not.toHaveBeenCalled()
    expect(r.results[0]).toMatchObject({
      companyId: 'agentive', disposition: 'mismatch', corePlan: 'pro', reason: 'dry_run',
    })
  })

  it('defaults to a dry run when no option is passed at all', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('agentive', 'amador@selfpreneur.com', null)], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('pro'))

    const r = await runPaidFounderPlanBackfillSweep()

    expect(r.dryRun).toBe(true)
    expect(h.setAppPlan).not.toHaveBeenCalled()
  })
})

describe('#1032 runPaidFounderPlanBackfillSweep — a real (--execute) run fixes only confirmed mismatches', () => {
  it('calls setAppPlan with core\'s real plan id for a confirmed mismatch (the Amador case)', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('agentive', 'amador@selfpreneur.com', null)], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('pro'))

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.fixed).toBe(1)
    expect(h.setAppPlan).toHaveBeenCalledWith('agentive', 'pro')
    expect(r.results[0]).toMatchObject({ disposition: 'mismatch', fixed: true })
  })

  it('never fixes a genuinely unpaid account (Greg Rose\'s case)', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('somecorp', 'greg.c.rose@gmail.com', null)], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('free'))

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.fixed).toBe(0)
    expect(h.setAppPlan).not.toHaveBeenCalled()
    expect(r.results[0]).toMatchObject({ disposition: 'confirmed_unpaid', corePlan: 'free' })
  })

  it('never fixes a company whose core lookup failed, even in a real run', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com', null)], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(unverified('request_failed:TimeoutError'))

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.fixed).toBe(0)
    expect(h.setAppPlan).not.toHaveBeenCalled()
    expect(r.results[0]).toMatchObject({ disposition: 'unverifiable', reason: 'request_failed:TimeoutError' })
  })

  it('leaves a company already correctly paid in the registry alone (no churn write, no core call)', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('already-good', 'c@d.com', 'business')], ok: true })

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.fixed).toBe(0)
    expect(h.fetchPlanByEmail).not.toHaveBeenCalled()
    expect(h.setAppPlan).not.toHaveBeenCalled()
    expect(r.results[0].disposition).toBe('already_paid_in_registry')
  })

  it('skips an anonymous company with no owner email', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('anon', undefined, null)], ok: true })

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(h.fetchPlanByEmail).not.toHaveBeenCalled()
    expect(r.results[0].disposition).toBe('no_owner_email')
  })

  it('finds every genuinely mismatched company in a mixed registry', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({
      apps: [
        app('agentive', 'amador@selfpreneur.com', null),      // pro in core, null in registry → mismatch
        app('somecorp', 'greg.c.rose@gmail.com', null),       // free in core → confirmed_unpaid
        app('already-good', 'c@d.com', 'business'),           // already paid in registry → skip
        app('anon', undefined, null),                          // no owner → skip
        app('flaky', 'err@x.com', undefined),                 // lookup fails → unverifiable
        app('stale', 'enterprise-founder@x.com', 'free'),     // enterprise in core, free in registry → mismatch
      ],
      ok: true,
    })
    h.fetchPlanByEmail.mockImplementation(async (email: string) => {
      if (email === 'amador@selfpreneur.com') return verified('pro')
      if (email === 'greg.c.rose@gmail.com') return verified('free')
      if (email === 'enterprise-founder@x.com') return verified('enterprise')
      return unverified('http_500')
    })

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.mismatches).toBe(2)
    expect(r.fixed).toBe(2)
    expect(h.setAppPlan).toHaveBeenCalledTimes(2)
    expect(h.setAppPlan).toHaveBeenCalledWith('agentive', 'pro')
    expect(h.setAppPlan).toHaveBeenCalledWith('stale', 'enterprise')
    expect(r.byDisposition).toMatchObject({
      mismatch: 2, confirmed_unpaid: 1, already_paid_in_registry: 1,
      no_owner_email: 1, unverifiable: 1,
    })
  })

  it('caches the plan lookup per owner across that owner\'s companies', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({
      apps: [app('one', 'same@x.com', null), app('two', 'same@x.com', null)], ok: true,
    })
    h.fetchPlanByEmail.mockResolvedValue(verified('pro'))

    await runPaidFounderPlanBackfillSweep({ dryRun: true })

    expect(h.fetchPlanByEmail).toHaveBeenCalledTimes(1)
  })
})

describe('#1032 runPaidFounderPlanBackfillSweep — honest reporting', () => {
  it('reports a failed registry read as registryOk:false, not as an empty success', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [], ok: false })

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.registryOk).toBe(false)
    expect(r.total).toBe(0)
    expect(h.fetchPlanByEmail).not.toHaveBeenCalled()
    expect(h.setAppPlan).not.toHaveBeenCalled()
  })

  it('counts a failed setAppPlan write as failed, never as fixed', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('agentive', 'amador@selfpreneur.com', null)], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('pro'))
    h.setAppPlan.mockResolvedValue(false)

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.fixed).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.results[0]).toMatchObject({ fixed: false, reason: 'set_plan_write_failed' })
  })

  it('skips soft-deleted companies entirely', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({
      apps: [app('gone', 'a@b.com', null, { lifecycleStatus: 'deleted' })], ok: true,
    })
    h.fetchPlanByEmail.mockResolvedValue(verified('pro'))

    const r = await runPaidFounderPlanBackfillSweep({ dryRun: false })

    expect(r.total).toBe(0)
    expect(h.setAppPlan).not.toHaveBeenCalled()
  })
})
