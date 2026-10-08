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
  setAppProvisioned: vi.fn(async () => true),
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
  provisionZeroDbViaMcp: vi.fn(async () => ({ ok: false })),
  isMcpProvisionEnabled: vi.fn(() => false),
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
    h.getPlanStatus.mockReset().mockResolvedValue({ tier: 'hobbyist' })
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
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise' })

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
      h.getPlanStatus.mockResolvedValue({ tier })

      const res = await POST(postRequest({ slug: 'flo' }))
      const body = await res.json()

      expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
      expect(body.keyKind).toBe('permanent')
    },
  )

  it('persists the real live plan onto the registry row so later reads stop showing an empty plan', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise' })

    await POST(postRequest({ slug: 'flo' }))

    const persisted = h.setAppProvisioned.mock.calls.at(-1)?.[1]
    expect(persisted.plan).toBe('enterprise')
    expect(persisted.keyKind).toBe('permanent')
  })

  // ── The free-trial path must NOT regress ────────────────────────────────
  it('keeps a genuinely unpaid signed-in founder on a tmp_ 72h trial (unchanged behavior)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
    expect(body.trial).toBe(true)
    expect(body.claimable).toBe(true)
    expect(body.expiresAt).toBeTruthy()
  })

  it('keeps a `starter` ($20) founder on tmp_ — starter is deliberately not a permanent-key tier', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'starter' })

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

  it('an UNPAID registry plan cannot drag a genuinely paid live founder down to tmp_', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise' })
    h.resolveApp.mockResolvedValue(unprovisionedCompany({ plan: 'hobbyist' }))

    const res = await POST(postRequest({ slug: 'flo' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', true)
    expect(body.keyKind).toBe('permanent')
  })

  it('ignores a client-sent `plan` in the request body entirely — entitlement is never taken from the caller', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })

    const res = await POST(postRequest({ slug: 'flo', plan: 'enterprise' }))
    const body = await res.json()

    expect(h.provisionInstantDb).toHaveBeenCalledWith('founder-real-jwt', false)
    expect(body.keyKind).toBe('tmp')
  })
})
