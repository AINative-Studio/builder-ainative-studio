import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1012 code-review finding 1 — CROSS-MODULE PLAN VOCABULARY CONSISTENCY.
 *
 * `fulfillPaidPlan` used to accept core's alias plan ids (`launch`, `company`)
 * and write them into the registry's `plan` field VERBATIM. Every other paid
 * gate in this repo normalizes those aliases BEFORE comparing:
 *
 *   - lib/ainative/plan.ts  → TIER_ALIASES: launch → pro, company → business
 *   - lib/ainative/active-plan.ts and app/api/build/subscription/status/route.ts
 *     keep the same PLAN_MAP
 *
 * …but the registry's own downstream readers compare the STORED STRING against
 * a literal set of canonical ids:
 *
 *   - lib/build/deploy.ts  PAID_PLANS = pro|business|enterprise|cody_vcto
 *     → isPaidPlan('launch') === false → subdomainServable() false
 *       → {slug}.ainative.studio is never served (middleware.ts)
 *   - claimSubdomain() → reason 'not_paid' for a founder who DID pay
 *   - setAppPlan()'s own `enrolled` flag → false, so nightly-loop enrollment
 *     silently never happens
 *
 * So a webhook that stamped the raw alias produced a row that the canonical
 * predicate (`isPaidTier`) calls paid while every registry consumer calls
 * unpaid. These tests assert the fix as a CROSS-MODULE property: whatever
 * string lands in the registry must satisfy BOTH `isPaidTier` (lib/ainative/
 * plan.ts, the consolidated source of truth from #762) AND `isPaidPlan`
 * (lib/build/deploy.ts, what the subdomain edge actually reads) — plus produce
 * `enrolled: true`, the third divergent reader.
 *
 * The real setAppPlan/resolveApp bodies run; only the ZeroDB network boundary
 * is faked.
 */

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  storeCompanyZerodbKey: vi.fn(async () => true),
}))
vi.mock('@/lib/build/instant-db', () => ({
  fileProjectUnderBuilderWorkspace: vi.fn(async () => ({ filed: true })),
  BUILDER_WORKSPACE_ID: 'ws-test',
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.ZERODB_PROJECT_ID = 'proj-test'
  process.env.AINATIVE_API_KEY = 'key-test'
  h.fetchMock.mockReset()
  vi.stubGlobal('fetch', h.fetchMock)
})

/** resolveAppVerified reads rows via res.text() then JSON.parse — provide both. */
function stubRegistry(entry: any | null) {
  h.fetchMock.mockImplementation(async (url: string, init?: any) => {
    const u = String(url)
    if (u.includes('/rows') && (init?.method || 'GET') === 'GET') {
      const body = { rows: entry ? [{ row_data: entry }] : [], total: entry ? 1 : 0 }
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any
    }
    return { ok: true, status: 200, json: async () => ({ id: 'row-new' }), text: async () => '{}' } as any
  })
}

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

const APP = {
  slug: 'agentive',
  chatId: 'c1',
  name: 'Agentive',
  createdAt: '2026-09-01T00:00:00.000Z',
  keyKind: 'permanent',
}

/**
 * The real assertion: a stored plan string must read as PAID from every module
 * that independently answers "is this company paid?"
 */
async function expectStoredPlanIsPaidEverywhere(stored: string) {
  const { isPaidTier } = await import('@/lib/ainative/plan')
  const { isPaidPlan } = await import('@/lib/build/deploy')
  expect(isPaidTier(stored), `lib/ainative/plan.ts isPaidTier("${stored}")`).toBe(true)
  expect(isPaidPlan(stored), `lib/build/deploy.ts isPaidPlan("${stored}")`).toBe(true)
}

describe('fulfillPaidPlan plan normalization (#1012 review finding 1)', () => {
  it.each([
    ['launch', 'pro'],
    ['company', 'business'],
  ])(
    'normalizes the core alias "%s" to the canonical "%s" before writing it to the registry',
    async (alias, canonical) => {
      stubRegistry(APP)
      const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
      const r = await fulfillPaidPlan('agentive', alias)

      expect(r.ok).toBe(true)
      expect(r.planSet).toBe(true)

      const rows = writtenRows()
      expect(rows.length).toBeGreaterThan(0)
      const row = rows[rows.length - 1]

      // The canonical id — NOT the raw alias — is what lands in the registry.
      expect(row.plan).toBe(canonical)
      expect(row.plan).not.toBe(alias)

      // The third divergent reader: setAppPlan's own nightly-loop enrollment.
      expect(row.enrolled).toBe(true)

      // And the cross-module property that was actually broken.
      await expectStoredPlanIsPaidEverywhere(row.plan)
    },
  )

  it.each(['pro', 'business', 'enterprise', 'cody_vcto'])(
    'leaves the already-canonical plan id "%s" untouched',
    async (plan) => {
      stubRegistry(APP)
      const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
      const r = await fulfillPaidPlan('agentive', plan)
      expect(r.planSet).toBe(true)
      const row = writtenRows().at(-1)
      expect(row.plan).toBe(plan)
      await expectStoredPlanIsPaidEverywhere(row.plan)
    },
  )

  it('normalizes core\'s long-form cody plan id to the canonical cody_vcto', async () => {
    stubRegistry(APP)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'cody__your_virtual_cto')
    expect(r.planSet).toBe(true)
    const row = writtenRows().at(-1)
    expect(row.plan).toBe('cody_vcto')
    await expectStoredPlanIsPaidEverywhere(row.plan)
  })

  it('normalizes case and surrounding whitespace', async () => {
    stubRegistry(APP)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', '  Launch  ')
    expect(r.planSet).toBe(true)
    const row = writtenRows().at(-1)
    expect(row.plan).toBe('pro')
    await expectStoredPlanIsPaidEverywhere(row.plan)
  })

  it('is idempotent against the CANONICAL stored value when the alias is re-delivered', async () => {
    // A company already fulfilled as 'pro'. A re-delivered webhook carrying the
    // alias 'launch' must recognise it as the same plan and append no churn row.
    stubRegistry({ ...APP, plan: 'pro' })
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    const r = await fulfillPaidPlan('agentive', 'launch')
    expect(r.ok).toBe(true)
    expect(r.planSet).toBe(false)
    expect(r.reason).toBe('already_fulfilled')
    expect(writtenRows()).toHaveLength(0)
  })

  it('still refuses a non-paid plan id, including its aliases', async () => {
    stubRegistry(APP)
    const { fulfillPaidPlan } = await import('@/lib/build/app-registry')
    for (const plan of ['hobbyist', 'free', 'basic', 'trial', 'starter', 'nonsense']) {
      const r = await fulfillPaidPlan('agentive', plan)
      expect(r.ok, plan).toBe(false)
      expect(r.reason, plan).toBe('not_a_paid_plan')
    }
    expect(writtenRows()).toHaveLength(0)
  })
})

describe('isPaidPlanId agrees with the canonical isPaidTier (#1012 review finding 3)', () => {
  it.each([
    'pro',
    'business',
    'enterprise',
    'cody_vcto',
    'cody__your_virtual_cto',
    'launch',
    'company',
    'hobbyist',
    'free',
    'starter',
    'basic',
    'trial',
    '',
    'nonsense',
  ])('answers identically to isPaidTier for "%s"', async (plan) => {
    const { isPaidPlanId } = await import('@/lib/build/app-registry')
    const { isPaidTier } = await import('@/lib/ainative/plan')
    expect(isPaidPlanId(plan)).toBe(isPaidTier(plan))
  })

  it('treats null/undefined as not paid', async () => {
    const { isPaidPlanId } = await import('@/lib/build/app-registry')
    expect(isPaidPlanId(null)).toBe(false)
    expect(isPaidPlanId(undefined)).toBe(false)
  })
})
