import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1012 — `fulfillPaidPlan()` in lib/build/app-registry.ts: the shared,
 * caller-agnostic fulfillment step that stamps a verified-paid plan onto a
 * company's registry row and (only when a real founder bearer token is
 * available) upgrades its tmp_ Instant DB project to permanent.
 *
 * This exists because fulfillment used to live ONLY inside
 * POST /api/build/subscription/verify, reachable only via the founder's own
 * browser completing the Stripe redirect. The webhook
 * (POST /api/webhooks/stripe) needs the exact same two steps with NO session,
 * so the decision logic is extracted here and unit-tested directly instead of
 * being duplicated per call site.
 *
 * The load-bearing property: a webhook has no founder JWT, so it can stamp the
 * plan but genuinely CANNOT claim the project (core's instant-db/claim
 * associates a project to a specific real account and needs that account's own
 * token — CODY.md Rule 5 forbids borrowing one). That limit must be reported
 * honestly as `keyClaimPending`, never silently swallowed, so the founder's
 * next authenticated Live load finishes the job.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  registerApp: vi.fn(async () => true),
  fetchMock: vi.fn(),
}))

// claimCompanyProject() dynamically imports these two on a successful claim;
// both pull Node-only/transitive deps that have nothing to do with what is
// under test here, so they are stubbed at the module boundary.
vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  storeCompanyZerodbKey: vi.fn(async () => true),
}))
vi.mock('@/lib/build/instant-db', () => ({
  fileProjectUnderBuilderWorkspace: vi.fn(async () => ({ filed: true })),
  BUILDER_WORKSPACE_ID: 'ws-test',
}))

// The real module is imported (not mocked) so setAppPlan/claimCompanyProject
// run their REAL bodies — only the ZeroDB/core network boundary is faked.
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.ZERODB_PROJECT_ID = 'proj-test'
  process.env.AINATIVE_API_KEY = 'key-test'
  h.fetchMock.mockReset()
  vi.stubGlobal('fetch', h.fetchMock)
})

/**
 * Fake the registry rows read + append writes that app-registry.ts performs.
 * NOTE: resolveAppVerified() reads the rows response via `res.text()` (then
 * JSON.parses it), not `res.json()` — the stub must provide both or the real
 * read silently throws and returns `{ entry: null }`, which quietly makes
 * every fulfillment look like a no-op. Found while building this test.
 */
function stubRegistry(entry: any | null, opts: { claimStatus?: number; claimBody?: any } = {}) {
  h.fetchMock.mockImplementation(async (url: string, init?: any) => {
    const u = String(url)
    if (u.includes('/instant-db/claim')) {
      const body = opts.claimBody ?? { api_key: 'sk_live_new' }
      return {
        ok: (opts.claimStatus ?? 200) < 400,
        status: opts.claimStatus ?? 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as any
    }
    if (u.includes('/rows') && (init?.method || 'GET') === 'GET') {
      const body = { rows: entry ? [{ row_data: entry }] : [], total: entry ? 1 : 0 }
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as any
    }
    // append write
    return { ok: true, status: 200, json: async () => ({ id: 'row-new' }), text: async () => '{}' } as any
  })
}

/** Capture the row_data of every append write performed against the registry. */
function writtenRows(): any[] {
  return h.fetchMock.mock.calls
    .filter(([url, init]: any[]) => String(url).includes('/rows') && init?.method === 'POST')
    .map(([, init]: any[]) => {
      try {
        const body = JSON.parse(init.body)
        return body?.row_data ?? body?.data ?? body
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

const TMP_APP = {
  slug: 'agentive',
  chatId: 'c1',
  name: 'Agentive',
  createdAt: '2026-09-01T00:00:00.000Z',
  zerodbProjectId: 'f17d948d-aaaa-bbbb-cccc-dddddddddddd',
  keyKind: 'tmp',
  claimToken: 'claim-tok-1',
  trialExpiresAt: '2026-09-24T00:00:00.000Z',
}

describe('fulfillPaidPlan (#1012)', () => {
  it('is a no-op for an unregistered slug', async () => {
    stubRegistry(null)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('nope', 'pro')
    expect(r).toEqual({ ok: false, planSet: false, keyClaimed: false, keyClaimPending: false, reason: 'not_registered' })
  })

  it('refuses a plan id that is not a real paid tier (never stamps a free plan)', async () => {
    stubRegistry(TMP_APP)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'hobbyist')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not_a_paid_plan')
    expect(r.planSet).toBe(false)
    expect(writtenRows()).toHaveLength(0)
  })

  it('stamps the paid plan on the registry row', async () => {
    stubRegistry(TMP_APP)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'pro')
    expect(r.ok).toBe(true)
    expect(r.planSet).toBe(true)
    const rows = writtenRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[rows.length - 1]).toMatchObject({ slug: 'agentive', plan: 'pro', enrolled: true })
  })

  it('does not re-append a plan row when the plan already matches (idempotent)', async () => {
    stubRegistry({ ...TMP_APP, plan: 'pro', keyKind: 'permanent', claimToken: undefined })
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'pro')
    expect(r.ok).toBe(true)
    expect(r.planSet).toBe(false)
    expect(writtenRows()).toHaveLength(0)
  })

  it('reports keyClaimPending (never claims) when no founder token is available', async () => {
    stubRegistry(TMP_APP)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'pro')
    expect(r.planSet).toBe(true)
    expect(r.keyClaimed).toBe(false)
    // The honest signal: this company still needs its tmp_ key claimed, and
    // only an authenticated founder request can do it.
    expect(r.keyClaimPending).toBe(true)
    // No claim call was attempted with a borrowed/absent token.
    const claimCalls = h.fetchMock.mock.calls.filter(([u]: any[]) => String(u).includes('/instant-db/claim'))
    expect(claimCalls).toHaveLength(0)
  })

  it('claims the tmp_ project when a real founder token IS supplied', async () => {
    stubRegistry(TMP_APP)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'pro', 'founder-jwt')
    expect(r.planSet).toBe(true)
    expect(r.keyClaimed).toBe(true)
    expect(r.keyClaimPending).toBe(false)
    const claimCalls = h.fetchMock.mock.calls.filter(([u]: any[]) => String(u).includes('/instant-db/claim'))
    expect(claimCalls).toHaveLength(1)
    expect(claimCalls[0][1].headers.Authorization).toBe('Bearer founder-jwt')
  })

  it('does not report keyClaimPending for a company already on a permanent key', async () => {
    stubRegistry({ ...TMP_APP, keyKind: 'permanent', claimToken: undefined })
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'pro')
    expect(r.planSet).toBe(true)
    expect(r.keyClaimPending).toBe(false)
  })

  it('still reports the plan stamp when a supplied token fails to claim', async () => {
    stubRegistry(TMP_APP, { claimStatus: 403, claimBody: { detail: 'forbidden' } })
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'pro', 'stale-jwt')
    expect(r.planSet).toBe(true)
    expect(r.keyClaimed).toBe(false)
    // Claim failed, so the company still needs one — report it as pending.
    expect(r.keyClaimPending).toBe(true)
  })
})
