import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/provision — key-kind gating must follow the founder's REAL,
 * LIVE plan (#1014).
 *
 * THE BUG: the route decided permanent-vs-tmp from `isPaidTier(existing.plan)`,
 * where `existing.plan` is a field on the company's OWN builder_app_registry
 * row. That field is ONLY ever written by the post-Stripe-checkout redirect
 * (`POST /api/build/subscription/verify`, itself unreliable — #1012) and two
 * internal loop jobs. It is NEVER derived from the founder's actual account
 * tier, so there was no code path anywhere that asked "is this founder, right
 * now, really paid?" at provisioning time.
 *
 * Confirmed live 2026-10-07: admin@ainative.studio is a genuine enterprise
 * account (`GET /v1/auth/me` → `"plan":"enterprise","role":"ADMIN"`), and the
 * company it created ("Flo") was still provisioned keyKind:'tmp' with a 72h
 * trialExpiresAt — identical to an anonymous signup with no account at all.
 *
 * THE FIX: resolve the founder's live tier from core with
 * `getPlanStatus(sessionToken)` (lib/ainative/plan.ts → fetchCorePlanIdentity →
 * `/api/v1/auth/me`) — the same mechanism, called the same way,
 * `app/api/build/growth/ad-test/route.ts` already uses for the identical "does
 * this founder really pay?" question, including its failure philosophy: fail
 * CLOSED to unpaid on a lookup error, but log it loudly so a core outage is
 * never silently mistaken for a real entitlement gap.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => null as any),
  resolveApp: vi.fn<(...args: any[]) => Promise<any>>(),
  // #1021: the #73 MCP wedge's own gate + provisioner, so the MCP branch can be
  // driven independently of the real ENABLE_MCP_PROVISION env flag.
  isMcpProvisionEnabled: vi.fn(() => false),
  provisionZeroDbViaMcp: vi.fn<(...args: any[]) => Promise<any>>(async () => ({ ok: false })),
  // Typed like resolveApp/provisionInstantDb below, and deliberately: an
  // untyped `vi.fn(async () => true)` gives `.mock.calls` an EMPTY-tuple
  // element type, so reading `calls.at(-1)?.[1]` (the persisted `fields`
  // object every assertion below needs) is a hard tsc error, not just a
  // weaker type. Mirrors the real exported signature in lib/build/app-registry.ts:
  // setAppProvisioned(slug, fields) => Promise<boolean>.
  setAppProvisioned: vi.fn<(slug: string, fields: Record<string, any>) => Promise<boolean>>(
    async () => true,
  ),
  setAppOwner: vi.fn(async () => true),
  provisionInstantDb: vi.fn<(...args: any[]) => Promise<any>>(),
  getPlanStatus: vi.fn<(...args: any[]) => Promise<any>>(),
  storeCompanyZerodbKey: vi.fn(async () => true),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppProvisioned: h.setAppProvisioned,
  setAppOwner: h.setAppOwner,
}))
// isPaidTier is the REAL implementation on purpose — the tier vocabulary
// (enterprise/pro/business/cody_vcto vs hobbyist/starter) is exactly what
// this gate's correctness depends on, so stubbing it would test nothing.
vi.mock('@/lib/ainative/plan', async (orig) => {
  const actual = await orig<typeof import('@/lib/ainative/plan')>()
  return { ...actual, getPlanStatus: h.getPlanStatus }
})
vi.mock('@/lib/build/deploy', () => ({
  deployPersistent: vi.fn(async () => ({ url: 'https://flo.ainative.studio', dnsPointable: true })),
}))
vi.mock('@/lib/build/instant-db', () => ({
  provisionInstantDb: h.provisionInstantDb,
  fileProjectUnderBuilderWorkspace: vi.fn(async () => ({ filed: true })),
  BUILDER_WORKSPACE_ID: 'test-workspace',
  TRIAL_WINDOW_MS: 72 * 60 * 60 * 1000,
}))
vi.mock('@/lib/build/zeropipeline', () => ({ provisionPipeline: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/zerocommerce', () => ({ provisionStore: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/opencapstack', () => ({ provisionCapTable: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/zeroforms', () => ({ provisionForm: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/agentflow', () => ({ provisionProject: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/zeroerp', () => ({ provisionZeroERPTenant: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/mcp-provision', () => ({
  provisionZeroDbViaMcp: h.provisionZeroDbViaMcp,
  isMcpProvisionEnabled: h.isMcpProvisionEnabled,
}))
vi.mock('@/lib/git/company-repo', () => ({
  provisionCompanyRepo: vi.fn(async () => ({ ok: false })),
  toFileMapForCommit: vi.fn(() => null),
}))
vi.mock('@/lib/build/ready-gate', () => ({ resolveStoredApp: vi.fn(async () => null) }))
vi.mock('@/lib/build/primitive-credentials', () => ({
  storeFounderCredential: vi.fn(async () => true),
  fetchOrganizationId: vi.fn(async () => undefined),
  hasFounderCredential: vi.fn(async () => true),
}))
vi.mock('@/lib/build/company-zerodb-credentials', () => ({ storeCompanyZerodbKey: h.storeCompanyZerodbKey }))

import { POST } from '@/app/api/build/provision/route'

function postRequest(body: Record<string, unknown>): any {
  return {
    json: async () => body,
    headers: new Headers(),
    cookies: { get: () => undefined },
  }
}

/** A registry row for a real, generated-but-not-yet-provisioned company. */
function unprovisionedCompany(overrides: Record<string, unknown> = {}) {
  return { slug: 'flo', chatId: 'chat-flo-1', name: 'Flo', ...overrides }
}

describe('POST /api/build/provision — permanent/tmp gating follows the REAL live plan (#1014)', () => {
  beforeEach(() => {
    h.auth.mockReset().mockResolvedValue({
      accessToken: 'founder-real-jwt',
      user: { email: 'admin@ainative.studio' },
    })
    h.resolveApp.mockReset().mockResolvedValue(unprovisionedCompany())
    h.setAppProvisioned.mockReset().mockResolvedValue(true)
    h.setAppOwner.mockReset().mockResolvedValue(true)
    h.storeCompanyZerodbKey.mockReset().mockResolvedValue(true)
    // #1021: the #73 MCP wedge is OFF by default here, exactly as it is in
    // production (confirmed 2026-10-08: ENABLE_MCP_PROVISION is not set at all
    // on the builder-ainative-studio Railway service), so every #1014 case
    // below continues to exercise the Instant-DB path it was written for.
    h.isMcpProvisionEnabled.mockReset().mockReturnValue(false)
    h.provisionZeroDbViaMcp.mockReset().mockResolvedValue({ ok: false })
    // `verified:true` is the default because that is what a REAL, reachable
    // core produces (fetchCorePlanIdentity sets it on every successful read).
    // Tests that model a core outage override it to false explicitly.
    h.getPlanStatus.mockReset().mockResolvedValue({ tier: 'hobbyist', verified: true })
    // Instant DB honors the `permanent` argument: a permanent request mints
    // sk_, anything else mints tmp_ (mirrors the real endpoint's behavior).
    h.provisionInstantDb
      .mockReset()
      .mockImplementation(async (_jwt: string | undefined, permanent?: boolean) =>
        permanent
          ? { ok: true, projectId: 'proj-perm', keyKind: 'permanent', apiKey: 'sk_real' }
          : { ok: true, projectId: 'proj-tmp', keyKind: 'tmp', apiKey: 'tmp_real', claimToken: 'claim-1' },
      )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mints a PERMANENT key for a genuinely enterprise founder whose registry plan is empty (the live admin@ainative.studio / Flo bug)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise', verified: true })

    const res = await POST(postRequest({ slug: 'flo', name: 'Flo' }))
    const body = await res.json()

    expect(h.getPlanStatus).toHaveBeenCalledWith('founder-real-jwt')
    // The real plan — not the absent registry field — decides the key kind.
    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
    expect(body.ok).toBe(true)
    expect(body.keyKind).toBe('permanent')
    expect(body.trial).toBe(false)
    expect(body.claimable).toBe(false)
    expect(body.expiresAt).toBeNull()
  })

  it.each(['pro', 'business', 'cody_vcto'])(
    'mints a PERMANENT key for a live %s founder with an empty registry plan',
    async (tier) => {
      h.getPlanStatus.mockResolvedValue({ tier, verified: true })

      const res = await POST(postRequest({ slug: 'flo' }))
      const body = await res.json()

      expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
      expect(body.keyKind).toBe('permanent')
    },
  )

  it('persists the real live plan onto the registry row so later reads stop showing an empty plan', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise', verified: true })

    await POST(postRequest({ slug: 'flo' }))

    const lastCall = h.setAppProvisioned.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    const persisted = lastCall![1]
    expect(persisted.plan).toBe('enterprise')
    expect(persisted.keyKind).toBe('permanent')
  })

  // ── The free-trial path must NOT regress ────────────────────────────────
  it('keeps a genuinely unpaid signed-in founder on a tmp_ 72h trial (unchanged behavior)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: true })

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
    expect(body.trial).toBe(true)
    expect(body.claimable).toBe(true)
    expect(body.expiresAt).toBeTruthy()
  })

  it('keeps a `starter` ($20) founder on tmp_ — starter is deliberately not a permanent-key tier', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'starter', verified: true })

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
  })

  it('keeps an ANONYMOUS founder on tmp_ and never attempts a live plan lookup (no token to look up with)', async () => {
    h.auth.mockResolvedValue(null)

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.getPlanStatus).not.toHaveBeenCalled()
    expect(h.provisionInstantDb).toHaveBeenCalledWith(undefined, false)
    expect(body.keyKind).toBe('tmp')
    expect(body.trial).toBe(true)
  })

  // ── Fail CLOSED on an unresolved lookup, loudly (growth/ad-test's rule) ──
  it('fails CLOSED to tmp_ and logs loudly when the live plan lookup THROWS — never grants a permanent key on an unresolved tier', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getPlanStatus.mockRejectedValue(new Error('core /auth/me 503'))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
    // Loud, honest log: a core outage must never silently read as "unpaid".
    expect(err).toHaveBeenCalled()
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).toContain('flo')
    expect(logged).toMatch(/NOT proof/i)
  })

  it('still honors a real paid plan already stamped on the registry row when the live lookup fails (Stripe-verified plan survives a core outage)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getPlanStatus.mockRejectedValue(new Error('core /auth/me 503'))
    h.resolveApp.mockResolvedValue(unprovisionedCompany({ plan: 'pro' }))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
    expect(body.keyKind).toBe('permanent')
  })

  // ── A core OUTAGE does not throw — it resolves `verified:false` ──────────
  //
  // Review finding (HIGH): the registry fallback above was effectively dead
  // code for the exact scenario it exists to cover. getPlanStatus NEVER throws
  // on a core outage: fetchCorePlanIdentity documents "Never throws — an
  // unreachable core yields `verified:false`" and returns
  // {rawPlan:null, verified:false}, which getPlanStatus then turned into a
  // NORMAL resolution of tier 'hobbyist' (normalizeTier(null)) while DISCARDING
  // the `verified` flag entirely. So the route's `liveTierResolved` — set false
  // only inside a `catch` — stayed TRUE through a real outage, the
  // `(!liveTierResolved && registryPaid)` branch never engaged, and a genuinely
  // paid founder creating a second company during a core blip was gated to a
  // 72h tmp_ trial: precisely the failure #1014's own comment says the fallback
  // prevents. The fix surfaces `verified` on PlanStatus so the route keys off a
  // REAL signal rather than "did an exception happen".
  it('honors a Stripe-verified registry plan when the live lookup RESOLVES UNVERIFIED (core outage, no exception thrown)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: false })
    h.resolveApp.mockResolvedValue(unprovisionedCompany({ plan: 'pro' }))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
    expect(body.keyKind).toBe('permanent')
    expect(body.trial).toBe(false)
  })

  it('still fails CLOSED to tmp_ on an UNVERIFIED lookup when the registry carries no paid plan either', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: false })
    h.resolveApp.mockResolvedValue(unprovisionedCompany())

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
  })

  // ── A CONFIRMED-unpaid founder must not get a stale paid plan re-stamped ──
  //
  // Review finding (MEDIUM): `const plan = livePaid ? liveTier : registryPlan`
  // re-wrote the registry's STALE paid value back onto the row even when the
  // live lookup had CONFIRMED (verified:true) the founder is no longer paid.
  // That contradicts the code's own "an unconfirmed or unpaid tier is
  // deliberately NOT written" comment, and `subdomainServable()`,
  // `claimSubdomain()` and the /api/build/deck paywall all read this field
  // directly and would treat the founder as paid against a confirmed live
  // answer. Only a live-paid result, or the unresolved/outage fallback above,
  // may ever produce a non-empty `plan`.
  it('does NOT re-stamp a stale paid registry plan when the live lookup CONFIRMS the founder is unpaid', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: true })
    h.resolveApp.mockResolvedValue(unprovisionedCompany({ plan: 'pro' }))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    // Confirmed unpaid ⇒ a real tmp_ trial, and no paid plan echoed back.
    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
    expect(body.plan).toBeNull()

    // …and critically, nothing writes 'pro' back into the row. The route's
    // `...(plan ? { plan } : {})` guard means an empty plan omits the key.
    const lastCall = h.setAppProvisioned.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    const persisted = lastCall![1]
    expect(persisted.plan).toBeUndefined()
  })

  it('an UNPAID registry plan cannot drag a genuinely paid live founder down to tmp_', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise', verified: true })
    h.resolveApp.mockResolvedValue(unprovisionedCompany({ plan: 'hobbyist' }))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
    expect(body.keyKind).toBe('permanent')
  })

  it('ignores a client-sent `plan` in the request body entirely — entitlement is never taken from the caller', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: true })

    const res = await POST(postRequest({ slug: 'flo', plan: 'enterprise' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
  })
})

/**
 * The #73 MCP provisioning wedge must answer the key-kind question the SAME way
 * (#1021).
 *
 * THE BUG: the `isMcpProvisionEnabled()` branch — the "Cody OPERATES the
 * primitive agentically" path — hardcoded `keyKind: 'permanent'` in both its
 * `setAppProvisioned` write and its JSON response, and consulted neither
 * `isPaid` nor any resolved plan at all. #1014 resolved the founder's real live
 * tier a few lines above and even stamped it onto the row through this branch,
 * but deliberately left the key-kind decision alone, so the two paths through
 * the SAME route disagreed about the same entitlement question: a hobbyist
 * founder got a 72h tmp_ trial via Instant DB and a PERMANENT project via MCP.
 * That is the exact "several code paths answer the same entitlement question
 * differently" class #762 consolidated `isPaidTier` to prevent.
 *
 * Inert in production today — ENABLE_MCP_PROVISION is not set at all on the
 * Railway service (verified 2026-10-08: absent from all 171 variables), and
 * `isMcpProvisionEnabled()` requires a literal '1'/'true' — so this was a
 * latent over-grant that would have activated the moment #73's flag was flipped
 * on. These tests pin the correct behavior BEFORE that happens.
 */
describe('POST /api/build/provision — the #73 MCP path honors the same resolved plan (#1021)', () => {
  beforeEach(() => {
    h.auth.mockReset().mockResolvedValue({
      accessToken: 'founder-real-jwt',
      user: { email: 'founder@example.com' },
    })
    h.resolveApp.mockReset().mockResolvedValue(unprovisionedCompany())
    h.setAppProvisioned.mockReset().mockResolvedValue(true)
    h.setAppOwner.mockReset().mockResolvedValue(true)
    h.storeCompanyZerodbKey.mockReset().mockResolvedValue(true)
    h.getPlanStatus.mockReset().mockResolvedValue({ tier: 'hobbyist', verified: true })
    h.provisionInstantDb
      .mockReset()
      .mockImplementation(async (_jwt: string | undefined, permanent?: boolean) =>
        permanent
          ? { ok: true, projectId: 'proj-perm', keyKind: 'permanent', apiKey: 'sk_real' }
          : { ok: true, projectId: 'proj-tmp', keyKind: 'tmp', apiKey: 'tmp_real', claimToken: 'claim-1' },
      )
    // Flag ON + a successful MCP provision ⇒ the MCP branch short-circuits and
    // owns the response. This is the only configuration in which the bug is
    // reachable at all.
    h.isMcpProvisionEnabled.mockReset().mockReturnValue(true)
    h.provisionZeroDbViaMcp
      .mockReset()
      .mockResolvedValue({ ok: true, projectId: 'mcp-proj-1', tablesCreated: ['waitlist'] })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** The persisted-fields object from the last setAppProvisioned call. */
  function lastPersisted(): Record<string, any> {
    const lastCall = h.setAppProvisioned.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    return lastCall![1]
  }

  // ── The over-grant itself ────────────────────────────────────────────────
  it('gives a genuinely UNPAID founder a tmp_ 72h trial, not a permanent key (the #1021 over-grant)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: true })

    const res = await POST(postRequest({ slug: 'flo', name: 'Flo' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.provisionedVia).toBe('mcp')
    expect(body.zerodbProjectId).toBe('mcp-proj-1')
    // The whole point: the real live plan, not a hardcoded constant.
    expect(body.keyKind).toBe('tmp')
    expect(body.trial).toBe(true)
    expect(body.claimable).toBe(true)
    expect(body.expiresAt).toBeTruthy()

    // …and the row must agree with the response, or the Live dashboard /
    // claimSubdomain / subdomainServable all read a permanent key that the
    // founder never earned.
    const persisted = lastPersisted()
    expect(persisted.keyKind).toBe('tmp')
    expect(persisted.trialExpiresAt).toBeTruthy()
  })

  it('keeps a `starter` ($20) founder on tmp_ through the MCP path too — starter is not a permanent-key tier', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'starter', verified: true })

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(body.provisionedVia).toBe('mcp')
    expect(body.keyKind).toBe('tmp')
    expect(body.trial).toBe(true)
  })

  it('gives an ANONYMOUS founder tmp_ through the MCP path (no token, genuinely unpaid)', async () => {
    h.auth.mockResolvedValue(null)

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.getPlanStatus).not.toHaveBeenCalled()
    expect(body.provisionedVia).toBe('mcp')
    expect(body.keyKind).toBe('tmp')
    expect(body.claimable).toBe(true)
  })

  // ── A genuinely paid founder still gets what they pay for ────────────────
  it.each(['enterprise', 'pro', 'business', 'cody_vcto'])(
    'still mints a PERMANENT key for a genuinely live-%s founder',
    async (tier) => {
      h.getPlanStatus.mockResolvedValue({ tier, verified: true })

      const res = await POST(postRequest({ slug: 'flo' }))
      const body = await res.json()

      expect(body.provisionedVia).toBe('mcp')
      expect(body.keyKind).toBe('permanent')
      expect(body.trial).toBe(false)
      expect(body.claimable).toBe(false)
      expect(body.expiresAt).toBeNull()
      expect(lastPersisted().keyKind).toBe('permanent')
    },
  )

  it('keeps stamping the live confirmed-paid plan onto the row (the one thing #1014 already fixed here)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise', verified: true })

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(body.plan).toBe('enterprise')
    expect(lastPersisted().plan).toBe('enterprise')
  })

  // ── The SAME failure policy as the Instant-DB path ───────────────────────
  it('honors a Stripe-verified registry plan when the live lookup resolves UNVERIFIED (core outage)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: false })
    h.resolveApp.mockResolvedValue(unprovisionedCompany({ plan: 'pro' }))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(body.provisionedVia).toBe('mcp')
    expect(body.keyKind).toBe('permanent')
  })

  it('fails CLOSED to tmp_ when the live lookup THROWS and the registry carries no paid plan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getPlanStatus.mockRejectedValue(new Error('core /auth/me 503'))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(body.provisionedVia).toBe('mcp')
    expect(body.keyKind).toBe('tmp')
  })

  // ── Flag-off behavior must be COMPLETELY unchanged ───────────────────────
  //
  // The MCP branch must stay unreachable with the flag off — the fix is a
  // gating change inside an already-gated branch, and must not make that
  // branch fire (or even call the MCP provisioner) for anyone.
  it('never reaches the MCP path when the flag is OFF — not even to ask', async () => {
    h.isMcpProvisionEnabled.mockReturnValue(false)
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise', verified: true })

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionZeroDbViaMcp).not.toHaveBeenCalled()
    expect(body.provisionedVia).toBeUndefined()
    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
    expect(body.zerodbProjectId).toBe('proj-perm')
    expect(body.keyKind).toBe('permanent')
  })

  it('falls through to Instant DB (unchanged) when the flag is on but the MCP provision does not succeed', async () => {
    h.provisionZeroDbViaMcp.mockResolvedValue({ ok: false, skipped: true, reason: 'not_configured' })
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist', verified: true })

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionZeroDbViaMcp).toHaveBeenCalled()
    expect(body.provisionedVia).toBeUndefined()
    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
  })
})
