import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/build/subscription/status — admin accounts must be reconciled too
 * (#1022).
 *
 * THE BUG, found during #1014's live investigation: `reconcilePlanFulfillment`
 * — the ONLY retroactive repair path for a company whose registry row is stuck
 * on `plan: null` / `keyKind: 'tmp'` — structurally could not run for an admin
 * account, for two INDEPENDENT, STACKING reasons:
 *
 *   1. The #309 staff bypass returned early (`if (identity.admin) return ...`)
 *      BEFORE the reconcile call was ever reached.
 *   2. Even with that early-return removed, the reconcile gate was
 *      `activePlan && identity.rawPlan`, and `fetchCorePlanIdentity` reports an
 *      admin as the literal `rawPlan: 'admin'` — not a key in this route's
 *      PLAN_MAP — so `activePlan` resolved to `null` and the gate failed anyway.
 *
 * WHY IT MATTERS (and why admins are NOT a "doesn't need reconciliation" case):
 * admin-ness is an attribute of the FOUNDER, but the stuck state lives on the
 * COMPANY's own registry row, and the consumers of that row cannot see who owns
 * it. `lib/build/deploy.ts`'s `isPaidPlan(entry.plan)` — which
 * `subdomainServable` and therefore middleware's wildcard-host serving depend
 * on — takes only `{plan, subdomainClaimed}`. So an admin-owned company sitting
 * on `plan: null` never gets `{slug}.ainative.studio` served, has its subdomain
 * claim refused as `not_paid`, and never sets `enrolled` for the nightly loop,
 * no matter how privileged its owner is. #1014 fixed this for NEW provisions
 * (getPlanStatus maps admin ⇒ 'enterprise', so `livePaid` is true); already-
 * broken existing companies can only be repaired here.
 *
 * `admin@ainative.studio` is a confirmed-genuine enterprise account
 * (`/v1/auth/me` → `"plan":"enterprise","role":"ADMIN"`), so reconciling it to
 * `enterprise` stamps an entitlement it really holds — not a fabricated one.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  fetchCorePlanIdentity: vi.fn(),
  reconcilePlanFulfillment: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/resolve-plan', () => ({ fetchCorePlanIdentity: h.fetchCorePlanIdentity }))
vi.mock('@/lib/build/app-registry', () => ({ reconcilePlanFulfillment: h.reconcilePlanFulfillment }))

import { GET } from '@/app/api/build/subscription/status/route'

function getReq(url: string) {
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.reconcilePlanFulfillment.mockResolvedValue({ planFixed: true, keyClaimed: false })
})

describe('GET /api/build/subscription/status — admin reconciliation (#1022)', () => {
  // ── Reason 1: the early-return ──────────────────────────────────────────────
  it('THE FIX (part 1): an admin with a slug DOES trigger reconciliation — the #309 staff bypass no longer returns before the reconcile call', async () => {
    h.auth.mockResolvedValue({ accessToken: 'admins-real-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: true,
      rawPlan: 'admin',
      email: 'admin@ainative.studio',
    })

    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=hexlock'))
    const json = await res.json()

    expect(json.plan).toBe('enterprise')
    expect(json.admin).toBe(true)
    expect(h.reconcilePlanFulfillment).toHaveBeenCalledTimes(1)
  })

  // ── Reason 2: 'admin' is not a PLAN_MAP key ────────────────────────────────
  it("THE FIX (part 2): reconciliation is handed a CANONICAL paid plan, never the literal 'admin' (which no registry reader treats as paid)", async () => {
    h.auth.mockResolvedValue({ accessToken: 'admins-real-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: true,
      rawPlan: 'admin',
      email: 'admin@ainative.studio',
    })

    await GET(getReq('http://localhost/api/build/subscription/status?slug=hexlock'))

    const call = h.reconcilePlanFulfillment.mock.calls.at(-1)!
    expect(call[0]).toBe('hexlock')
    // 'enterprise' — the tier an admin genuinely holds, in the SAME vocabulary
    // deploy.ts's isPaidPlan / setAppPlan's `enrolled` / claimSubdomain read.
    // Writing the raw 'admin' string would store a plan every one of those
    // readers calls UNPAID, leaving the company just as stuck (the #1012
    // review's alias-vs-canonical finding, in a new disguise).
    expect(call[1]).toBe('enterprise')
    // The founder's OWN real session token — never borrowed, never service-level
    // (CODY.md Rule 5); claimCompanyProject associates the project to this account.
    expect(call[2]).toBe('admins-real-jwt')
  })

  it('still reports admins as enterprise with the same response shape the Live dashboard already consumes (#309 bypass preserved)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'admin-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: true,
      rawPlan: 'admin',
      email: 'admin@ainative.studio',
    })

    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=hexlock'))
    const json = await res.json()

    expect(json).toMatchObject({
      plan: 'enterprise',
      rawPlan: 'admin',
      signedIn: true,
      admin: true,
      email: 'admin@ainative.studio',
      trialExpiresAt: null,
    })
  })

  it('an admin with NO slug never reconciles — there is no company to reconcile', async () => {
    h.auth.mockResolvedValue({ accessToken: 'admin-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: true,
      rawPlan: 'admin',
      email: 'admin@ainative.studio',
    })

    const res: any = await GET(getReq('http://localhost/api/build/subscription/status'))
    const json = await res.json()

    expect(json.plan).toBe('enterprise')
    expect(h.reconcilePlanFulfillment).not.toHaveBeenCalled()
  })

  it('an UNVERIFIED core read never reconciles, even when the cached identity claims admin — a core outage is not an entitlement answer (#762)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'admin-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: false, admin: true, rawPlan: 'admin' })

    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=hexlock'))
    const json = await res.json()

    expect(json).toEqual({ plan: null, signedIn: true })
    expect(h.reconcilePlanFulfillment).not.toHaveBeenCalled()
  })

  it("a reconciliation failure never fails or blocks an admin's response", async () => {
    h.auth.mockResolvedValue({ accessToken: 'admin-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: true,
      rawPlan: 'admin',
      email: 'admin@ainative.studio',
    })
    h.reconcilePlanFulfillment.mockRejectedValue(new Error('boom'))

    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=hexlock'))

    expect(res.status).toBe(200)
    expect((await res.json()).plan).toBe('enterprise')
  })
})
