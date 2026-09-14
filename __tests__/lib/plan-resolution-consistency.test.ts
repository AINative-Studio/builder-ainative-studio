/**
 * #762 — Builder must resolve "what plan is this user on?" CONSISTENTLY, from
 * ONE authoritative source, no matter which code path asks.
 *
 * The real, live bug this pins down: for a genuine paying Enterprise customer
 * (admin@winning.careers), in the SAME session moments apart —
 *   GET  /api/build/subscription/status → {"plan":"enterprise"}   (reads /api/v1/auth/me)
 *   POST /api/build/zerovoice           → {"ok":false,"reason":"tier","tier":"hobbyist"}
 *                                          (read /api/v1/subscription via getPlanStatus)
 *
 * Root cause, measured live against production core:
 *   GET /api/v1/auth/me       → 200 in 0.09s, plan: "enterprise"
 *   GET /api/v1/subscription  → 200 in 60.1s  ← exceeds ainativeFetch's 20s timeout
 * …so getPlanStatus's `catch { tier = 'hobbyist' }` silently demoted a paying
 * customer, and a core outage was indistinguishable from a real Hobbyist account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ENTERPRISE_ME = {
  id: 'b0cdaa79-7ccf-4ef4-8409-65ab8cc32bcc',
  email: 'admin@winning.careers',
  role: 'USER',
  is_superuser: false,
  plan: 'enterprise',
  trial_expires_at: null,
}

/** Core's /api/v1/subscription shape, with a plan id we can vary per test. */
function subscriptionPayload(planId: string, status = 'active') {
  return {
    success: true,
    data: {
      subscription: {
        id: 'sub_1',
        status,
        trial_end: null,
        plan: { id: planId, name: planId, price: 999 },
      },
    },
  }
}

/**
 * Install a fake global fetch that answers each core endpoint independently, so
 * a test can make the two endpoints DISAGREE about the same account.
 */
function mockCore(opts: {
  me?: unknown
  meStatus?: number
  meReject?: Error
  subscription?: unknown
  subscriptionReject?: Error
  workspaces?: unknown
  projects?: unknown
}) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      const url = String(typeof input === 'string' ? input : input?.url ?? input)
      calls.push(url)

      const json = (body: unknown, status = 200) =>
        ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as any

      if (url.includes('/api/v1/auth/me')) {
        if (opts.meReject) throw opts.meReject
        return json(opts.me ?? ENTERPRISE_ME, opts.meStatus ?? 200)
      }
      if (url.includes('/api/v1/subscription')) {
        if (opts.subscriptionReject) throw opts.subscriptionReject
        return json(opts.subscription ?? subscriptionPayload('enterprise'))
      }
      if (url.includes('/api/v1/workspaces')) {
        return json(opts.workspaces ?? { workspaces: [{ id: 'w1', is_default: true }] })
      }
      if (url.includes('/api/v1/projects')) {
        return json(opts.projects ?? [])
      }
      return json({}, 404)
    }),
  )
  return calls
}

async function importPlan() {
  return await import('@/lib/ainative/plan')
}

describe('#762 — one authoritative plan source across every code path', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('THE BUG: /api/v1/subscription timing out no longer demotes a paying Enterprise customer', async () => {
    // Exactly the live failure: /auth/me is healthy and says enterprise, while
    // /api/v1/subscription blows past its timeout (the 60.1s response measured
    // in production surfaced here as ainativeFetch's AbortError → 504).
    mockCore({
      me: ENTERPRISE_ME,
      subscriptionReject: Object.assign(new Error('timed out'), { name: 'AbortError' }),
    })

    const { getPlanStatus } = await importPlan()
    const status = await getPlanStatus('real-enterprise-token')

    // Before the fix this was 'hobbyist' — the exact rejection the founder hit.
    expect(status.tier).toBe('enterprise')
    expect(status.tierLabel).toBe('Enterprise')
  })

  it('a paid tier survives /api/v1/subscription returning a 500', async () => {
    mockCore({
      me: ENTERPRISE_ME,
      subscription: { detail: 'internal error' },
      subscriptionReject: Object.assign(new Error('AINative API GET /api/v1/subscription failed'), {
        name: 'AINativeApiError',
      }),
    })

    const { getPlanStatus } = await importPlan()
    expect((await getPlanStatus('t')).tier).toBe('enterprise')
  })

  it('when the two core endpoints DISAGREE, /api/v1/auth/me wins (and the conflict is logged)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Same account, same moment, two different answers from core.
    mockCore({
      me: ENTERPRISE_ME,                                 // says enterprise
      subscription: subscriptionPayload('hobbyist'),      // says hobbyist
    })

    const { getPlanStatus } = await importPlan()
    const status = await getPlanStatus('t')

    expect(status.tier).toBe('enterprise')
    // The disagreement must be visible, not silently resolved.
    expect(warn.mock.calls.flat().join(' ')).toMatch(/DISAGREE/i)
  })

  it('getPlanStatus and the subscription/status route agree for the SAME account', async () => {
    // subscription/status resolves via fetchCorePlanIdentity; getPlanStatus now
    // resolves through the very same reader. Both must land on 'enterprise'
    // even while /api/v1/subscription insists otherwise.
    mockCore({ me: ENTERPRISE_ME, subscription: subscriptionPayload('hobbyist') })

    const { getPlanStatus, isPaidTier } = await importPlan()
    const { fetchCorePlanIdentity } = await import('@/lib/ainative/resolve-plan')

    const planStatus = await getPlanStatus('t')
    const identity = await fetchCorePlanIdentity('t')

    expect(identity.rawPlan).toBe('enterprise')
    expect(planStatus.tier).toBe('enterprise')
    // …and the entitlement gate that rejected this founder now passes.
    expect(isPaidTier(planStatus.tier)).toBe(true)
  })

  it('a genuine Hobbyist is still Hobbyist (the fix does not over-grant)', async () => {
    mockCore({
      me: { ...ENTERPRISE_ME, plan: 'hobbyist' },
      subscription: subscriptionPayload('hobbyist', 'trialing'),
    })

    const { getPlanStatus, isPaidTier } = await importPlan()
    const status = await getPlanStatus('t')

    expect(status.tier).toBe('hobbyist')
    expect(isPaidTier(status.tier)).toBe(false)
  })

  it('an unreachable /api/v1/auth/me fails CLOSED to hobbyist but LOGS it loudly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCore({ meReject: new Error('ECONNREFUSED') })

    const { getPlanStatus } = await importPlan()
    const status = await getPlanStatus('t')

    // Safe default — never over-grant a real, billed resource.
    expect(status.tier).toBe('hobbyist')
    // …but the operator can tell this apart from a real Hobbyist account.
    const logged = error.mock.calls.flat().join(' ')
    expect(logged).toMatch(/PLAN VERIFICATION FAILED/i)
    expect(logged).toMatch(/PAYING customer may be wrongly denied/i)
  })

  it('usage + trial data is still populated (the fix preserves PlanStatus in full)', async () => {
    mockCore({
      me: ENTERPRISE_ME,
      subscription: subscriptionPayload('enterprise', 'active'),
      workspaces: { workspaces: [{ id: 'w1', is_default: true }, { id: 'w2' }] },
      projects: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    })

    const { getPlanStatus } = await importPlan()
    const status = await getPlanStatus('t')

    expect(status.tier).toBe('enterprise')
    expect(status.status).toBe('active')
    expect(status.trial.active).toBe(false)
    // Real counts from listWorkspaces/listProjects — NOT lost in the refactor.
    expect(status.workspaces.used).toBe(2)
    expect(status.projects.used).toBe(3)
    // Enterprise is unlimited on both.
    expect(status.workspaces.unlimited).toBe(true)
    expect(status.projects.unlimited).toBe(true)
  })

  it('trial state still comes through for a trialing account', async () => {
    const endsAt = new Date(Date.now() + 3 * 86_400_000).toISOString()
    mockCore({
      me: { ...ENTERPRISE_ME, plan: 'hobbyist' },
      subscription: {
        success: true,
        data: {
          subscription: { status: 'trialing', trial_end: endsAt, plan: { id: 'hobbyist' } },
        },
      },
    })

    const { getPlanStatus } = await importPlan()
    const status = await getPlanStatus('t')

    expect(status.status).toBe('trialing')
    expect(status.trial.active).toBe(true)
    expect(status.trial.endsAt).toBe(endsAt)
    expect(status.trial.daysLeft).toBeGreaterThan(0)
  })

  it('an AINative admin resolves to enterprise regardless of the subscription row', async () => {
    mockCore({
      me: { ...ENTERPRISE_ME, role: 'ADMIN', plan: '' },
      subscription: subscriptionPayload('hobbyist'),
    })

    const { getPlanStatus } = await importPlan()
    expect((await getPlanStatus('t')).tier).toBe('enterprise')
  })

  it('the tier NEVER comes from /api/v1/subscription — /auth/me alone decides', async () => {
    // Core's slow endpoint is entirely absent; resolution must still succeed.
    mockCore({
      me: { ...ENTERPRISE_ME, plan: 'pro' },
      subscriptionReject: new Error('endpoint removed'),
    })

    const { getPlanStatus } = await importPlan()
    expect((await getPlanStatus('t')).tier).toBe('pro')
  })
})

describe('#762 — every paid plan core sells resolves as paid', () => {
  it('business and cody_vcto are real paid tiers, not hobbyist', async () => {
    const { normalizeTier, isPaidTier } = await importPlan()

    // These previously fell through normalizeTier's `in TIER_LIMITS` check to
    // 'hobbyist', so a paying Business customer was denied paid features even
    // when core answered instantly and correctly.
    expect(normalizeTier('business')).toBe('business')
    expect(normalizeTier('cody_vcto')).toBe('cody_vcto')
    expect(isPaidTier('business')).toBe(true)
    expect(isPaidTier('cody_vcto')).toBe(true)
  })

  it('catalog aliases resolve to the same tier everywhere (launch→pro, company→business)', async () => {
    const { normalizeTier, isPaidTier } = await importPlan()

    expect(normalizeTier('launch')).toBe('pro')
    expect(normalizeTier('company')).toBe('business')
    expect(isPaidTier('launch')).toBe(true)
    expect(isPaidTier('company')).toBe(true)
  })

  it('unpaid/unknown plans are not paid', async () => {
    const { isPaidTier } = await importPlan()
    for (const p of ['hobbyist', 'free', '', null, undefined, 'made-up']) {
      expect(isPaidTier(p as any)).toBe(false)
    }
  })

  it('isPaidTier accepts BOTH vocabularies, so gates cannot drift apart', async () => {
    const { isPaidTier } = await importPlan()
    // normalized limit tiers (what getPlanStatus returns) …
    for (const t of ['pro', 'business', 'enterprise', 'cody_vcto']) {
      expect(isPaidTier(t)).toBe(true)
    }
    // … and the ActivePlan/catalog ids the app-registry stores.
    for (const t of ['launch', 'company']) {
      expect(isPaidTier(t)).toBe(true)
    }
  })
})
