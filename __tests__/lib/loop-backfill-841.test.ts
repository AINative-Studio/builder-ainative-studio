import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #841 — backfill sweep for companies that are genuinely paid but were never
 * auto-enrolled in the nightly loop.
 *
 * #826 wired enroll+dispatch into POST /api/build/subscription/verify, which
 * only ever fires on a NEW conversion. Any company already sitting in a
 * paid-but-never-enrolled state before that shipped has no second trigger and
 * stays stuck forever — empty backlog, Auto Mode permanently OFF.
 *
 * These tests pin the safety contract, because a real run of this sweep fires
 * billable swarm dispatches at live customer companies:
 *   - dry run NEVER enrolls,
 *   - a real run enrolls ONLY genuinely-qualifying companies,
 *   - an already-enrolled company is skipped (idempotency),
 *   - an unverifiable/missing paid signal is SKIPPED, never guessed at.
 */

const h = vi.hoisted(() => ({
  listAllAppsWithStatus: vi.fn() as ReturnType<typeof vi.fn>,
  enrollCompany: vi.fn(async (_e: unknown): Promise<boolean> => true),
  isEnrolled: vi.fn(async (_slug: string): Promise<boolean> => false),
  runNightlyLoop: vi.fn(
    async (_i: unknown): Promise<{ status: string; taskId?: string | null; detail?: string }> =>
      ({ status: 'dispatched', taskId: 't1' }),
  ),
  fetchPlanByEmail: vi.fn() as ReturnType<typeof vi.fn>,
}))

vi.mock('@/lib/build/app-registry', () => ({
  listAllAppsWithStatus: h.listAllAppsWithStatus,
}))
vi.mock('@/lib/build/loop-enrollment', () => ({
  enrollCompany: h.enrollCompany,
  isEnrolled: h.isEnrolled,
}))
vi.mock('@/lib/build/autonomous-loop', () => ({
  runNightlyLoop: h.runNightlyLoop,
}))
vi.mock('@/lib/ainative/admin-plan-lookup', () => ({
  fetchPlanByEmail: h.fetchPlanByEmail,
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runLoopBackfillSweep, toActivePlan } from '@/lib/build/loop-backfill'
import { classifyBackfillCandidate } from '@/lib/build/live-vs-planned'

const app = (slug: string, ownerEmail?: string, extra: Record<string, unknown> = {}) => ({
  slug, chatId: `chat-${slug}`, name: slug, track: 'company', ownerEmail, ...extra,
})

const verified = (plan: string) => ({ plan, email: 'x@y.com', verified: true })
const unverified = (reason: string) => ({ plan: null, email: null, verified: false, reason })

beforeEach(() => {
  vi.clearAllMocks()
  h.isEnrolled.mockResolvedValue(false)
  h.enrollCompany.mockResolvedValue(true)
  h.runNightlyLoop.mockResolvedValue({ status: 'dispatched', taskId: 't1' })
  h.listAllAppsWithStatus.mockResolvedValue({ apps: [], ok: true })
})

describe('#841 classifyBackfillCandidate — the pure safety gate', () => {
  const base = {
    planVerified: true, paid: true, planUnlocksLoop: true,
    alreadyEnrolled: false, hasOwnerEmail: true,
  }

  it('enrolls only a verified, paid, loop-eligible, not-yet-enrolled company', () => {
    expect(classifyBackfillCandidate(base)).toBe('enroll')
  })

  it('skips an already-enrolled company even when it fully qualifies (idempotency)', () => {
    expect(classifyBackfillCandidate({ ...base, alreadyEnrolled: true })).toBe('already_enrolled')
  })

  it('FAILS CLOSED when the plan could not be verified — never treats it as paid', () => {
    expect(classifyBackfillCandidate({ ...base, planVerified: false })).toBe('unverifiable')
    // and specifically never 'enroll', whatever the stale paid flag says
    expect(classifyBackfillCandidate({ ...base, planVerified: false, paid: true })).not.toBe('enroll')
  })

  it('skips a confirmed unpaid account', () => {
    expect(classifyBackfillCandidate({ ...base, paid: false })).toBe('not_paid')
  })

  it('separates a REALLY paying but non-loop tier (Pro) from an unpaid one', () => {
    expect(classifyBackfillCandidate({ ...base, planUnlocksLoop: false })).toBe('paid_not_loop_tier')
  })

  it('skips an anonymous company with no owner to attribute a plan to', () => {
    expect(classifyBackfillCandidate({ ...base, hasOwnerEmail: false })).toBe('no_owner_email')
  })

  it('checks enrollment BEFORE paid status, so an enrolled company is inert regardless of plan', () => {
    expect(classifyBackfillCandidate({
      ...base, alreadyEnrolled: true, planVerified: false, paid: false,
    })).toBe('already_enrolled')
  })
})

describe('#841 toActivePlan — core plan id → Builder ActivePlan', () => {
  it('maps core paid ids and their aliases', () => {
    expect(toActivePlan('business')).toBe('business')
    expect(toActivePlan('enterprise')).toBe('enterprise')
    expect(toActivePlan('pro')).toBe('pro')
    expect(toActivePlan('company')).toBe('business') // alias
    expect(toActivePlan('launch')).toBe('pro')       // alias
  })

  it('resolves unpaid/unknown/missing plans to locked ("")', () => {
    for (const p of ['free', 'hobbyist', 'starter', 'nonsense', '', null, undefined]) {
      expect(toActivePlan(p)).toBe('')
    }
  })
})

describe('#841 runLoopBackfillSweep — dry run never writes', () => {
  it('reports a qualifying company as a candidate but enrolls nothing', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))

    const r = await runLoopBackfillSweep({ dryRun: true })

    expect(r.dryRun).toBe(true)
    expect(r.candidates).toBe(1)
    expect(r.enrolled).toBe(0)
    expect(h.enrollCompany).not.toHaveBeenCalled()
    expect(h.runNightlyLoop).not.toHaveBeenCalled()
    expect(r.results[0]).toMatchObject({ companyId: 'acme', disposition: 'enroll', reason: 'dry_run' })
  })

  it('defaults to a dry run when no option is passed at all', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('enterprise'))

    const r = await runLoopBackfillSweep()

    expect(r.dryRun).toBe(true)
    expect(h.enrollCompany).not.toHaveBeenCalled()
    expect(h.runNightlyLoop).not.toHaveBeenCalled()
  })
})

describe('#841 runLoopBackfillSweep — a real run enrolls only what qualifies', () => {
  it('enrolls + dispatches a genuinely paid, loop-eligible, unenrolled company', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(1)
    expect(r.dispatched).toBe(1)
    expect(h.enrollCompany).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'acme', track: 'company', ownerKey: 'a@b.com' }),
    )
    expect(h.runNightlyLoop).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'acme' }),
    )
  })

  it('enrolls every genuinely qualifying company in a mixed registry (#841 — Pro is now loop-eligible)', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({
      apps: [
        app('paid-loop', 'biz@x.com'),      // business  → enroll
        app('paid-pro', 'pro@x.com'),       // pro       → enroll (Pro is loop-eligible per #841)
        app('freebie', 'free@x.com'),       // free      → not paid
        app('anon'),                        // no owner  → skip
        app('flaky', 'err@x.com'),          // lookup failed → fail closed
        app('done', 'biz@x.com'),           // already enrolled
      ],
      ok: true,
    })
    h.fetchPlanByEmail.mockImplementation(async (email: string) => {
      if (email === 'biz@x.com') return verified('business')
      if (email === 'pro@x.com') return verified('pro')
      if (email === 'free@x.com') return verified('free')
      return unverified('http_500')
    })
    h.isEnrolled.mockImplementation(async (slug: string) => slug === 'done')

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(2)
    expect(h.enrollCompany).toHaveBeenCalledTimes(2)
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'paid-loop' }))
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'paid-pro' }))
    expect(r.byDisposition).toMatchObject({
      enroll: 2, not_paid: 1,
      no_owner_email: 1, unverifiable: 1, already_enrolled: 1,
    })
  })

  it('never enrolls a company whose plan lookup failed, even in a real run', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(unverified('request_failed:TimeoutError'))

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(0)
    expect(h.enrollCompany).not.toHaveBeenCalled()
    expect(h.runNightlyLoop).not.toHaveBeenCalled()
    expect(r.results[0]).toMatchObject({ disposition: 'unverifiable', reason: 'request_failed:TimeoutError' })
  })

  it('enrolls a real Pro company (#841 — agentive/amador was the live example of this bug)', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('agentive', 'amador@x.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('pro'))

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(1)
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'agentive' }))
    expect(h.runNightlyLoop).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'agentive' }))
    expect(r.results[0]).toMatchObject({ disposition: 'enroll', plan: 'pro' })
  })
})

describe('#841 runLoopBackfillSweep — idempotency', () => {
  it('skips an already-enrolled company without enrolling or dispatching', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))
    h.isEnrolled.mockResolvedValue(true)

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(0)
    expect(r.candidates).toBe(0)
    expect(h.enrollCompany).not.toHaveBeenCalled()
    expect(h.runNightlyLoop).not.toHaveBeenCalled()
    expect(r.results[0].disposition).toBe('already_enrolled')
  })

  it('a second run right after a real one is a no-op (no double-enroll/dispatch)', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))

    const first = await runLoopBackfillSweep({ dryRun: false })
    expect(first.enrolled).toBe(1)

    // The company is now really enrolled — the store reflects it.
    h.isEnrolled.mockResolvedValue(true)
    const second = await runLoopBackfillSweep({ dryRun: false })

    expect(second.enrolled).toBe(0)
    expect(h.enrollCompany).toHaveBeenCalledTimes(1)
    expect(h.runNightlyLoop).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the enrollment check itself throws — never enrolls blind', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))
    h.isEnrolled.mockRejectedValue(new Error('zerodb down'))

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(0)
    expect(h.enrollCompany).not.toHaveBeenCalled()
    expect(r.results[0]).toMatchObject({ disposition: 'unverifiable', reason: 'enrollment_check_failed' })
  })
})

describe('#841 runLoopBackfillSweep — honest reporting', () => {
  it('reports a failed registry read as registryOk:false, not as an empty success', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [], ok: false })

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.registryOk).toBe(false)
    expect(r.total).toBe(0)
    expect(h.fetchPlanByEmail).not.toHaveBeenCalled()
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('counts a failed enrollment write as failed — never as enrolled', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))
    h.enrollCompany.mockResolvedValue(false)

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(0)
    expect(r.failed).toBe(1)
    expect(h.runNightlyLoop).not.toHaveBeenCalled()
    expect(r.results[0]).toMatchObject({ enrolled: false, reason: 'enroll_write_failed' })
  })

  it('keeps the enrollment but reports honestly when the dispatch fails', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [app('acme', 'a@b.com')], ok: true })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))
    h.runNightlyLoop.mockResolvedValue({ status: 'error', detail: 'swarm unavailable' })

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.enrolled).toBe(1)
    expect(r.dispatched).toBe(0)
    expect(r.results[0]).toMatchObject({ enrolled: true, dispatched: false, reason: 'dispatch_error' })
  })

  it('skips soft-deleted companies entirely', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({
      apps: [app('gone', 'a@b.com', { lifecycleStatus: 'deleted' })], ok: true,
    })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))

    const r = await runLoopBackfillSweep({ dryRun: false })

    expect(r.total).toBe(0)
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('caches the plan lookup per owner across that owner\'s companies', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({
      apps: [app('one', 'same@x.com'), app('two', 'same@x.com')], ok: true,
    })
    h.fetchPlanByEmail.mockResolvedValue(verified('business'))

    await runLoopBackfillSweep({ dryRun: true })

    expect(h.fetchPlanByEmail).toHaveBeenCalledTimes(1)
  })
})
