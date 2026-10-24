import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes (see app-registry-core.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

const h = vi.hoisted(() => ({ storeCompanyZerodbKey: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  storeCompanyZerodbKey: h.storeCompanyZerodbKey,
}))

import {
  claimCompanyProject,
  reconcilePlanFulfillment,
  __resetRegistryCacheForTests,
} from '@/lib/build/app-registry'

/**
 * #1492 — follow-up to #1486/#1491. `claimCompanyProject` and
 * `reconcilePlanFulfillment` were the two functions in app-registry.ts left
 * out of #1491's pass, because unlike the 22 `setApp*` setters (which return a
 * bare `boolean` and so got the throw-based RegistryLookupUnverifiedError) both
 * of these already return a STRUCTURED result. Their fix is therefore a new,
 * explicit reason on that existing shape — not a throw.
 *
 * Both still resolved their pre-write target with a plain `resolveApp(slug)`,
 * whose single `null` return collapses "this company is confirmed not
 * registered" with "the registry read itself failed" (the #832 anti-pattern):
 *
 *   - claimCompanyProject reported `reason: 'not_registered'` — which every
 *     caller treats as a DETERMINISTIC refusal and never retries — for a
 *     company that exists and still has a real, unspent claimToken.
 *   - reconcilePlanFulfillment returned a bare `{planFixed:false,
 *     keyClaimed:false}`, i.e. "checked, nothing to repair." That is the
 *     worst case of the two: this function is the ONLY retry a real paying
 *     founder whose Stripe redirect died ever gets, so a transient hiccup
 *     silently consumed an attempt while reporting a clean no-op.
 *
 * This suite pins all three states for both functions:
 *   1. CONFIRMED SUCCESS   → unchanged.                    [regression guard]
 *   2. CONFIRMED ABSENCE   → unchanged ('not_registered' / bare no-op).
 *                                                          [regression guard]
 *   3. UNVERIFIED LOOKUP   → NEW: distinguishable, and no write attempted.
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

/** A read that FAILED (non-ok) — fetchAllRegistryRows returns ok:false, so
 *  resolveAppVerified reports { entry: null, verified: false }: "couldn't
 *  check", NOT "confirmed gone". */
function readFailedResponse(): Response {
  return { ok: false, status: 503, text: async () => 'upstream unavailable' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

/** A company in the exact state both functions exist to repair: a real,
 *  provisioned project still on an unclaimed 72h tmp_ key. */
function claimableRow(slug: string, extra: Record<string, unknown> = {}): any {
  return row(slug, {
    zerodbProjectId: `proj-${slug}`,
    keyKind: 'tmp',
    claimToken: 'tok-1',
    ...extra,
  })
}

const postsOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')

// =======================================
// claimCompanyProject
// =======================================
describe('claimCompanyProject unverified-lookup handling (#1492)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    h.storeCompanyZerodbKey.mockClear()
    h.storeCompanyZerodbKey.mockResolvedValue(true)
    __resetRegistryCacheForTests()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetRegistryCacheForTests()
  })

  // ---- Case 1: CONFIRMED SUCCESS — unchanged (regression guard) ----
  it('still claims and flips the key to permanent when the company is confirmed present', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([claimableRow('acme')])) // lookup
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ api_key: 'sk_new' }),
    } as unknown as Response) // the external claim
    fetchMock.mockResolvedValueOnce(okResponse()) // registerApp write

    const res = await claimCompanyProject('acme', 'valid-jwt')

    expect(res.ok).toBe(true)
    expect(res.claimed).toBe(true)
    expect(res.reason).toBeUndefined()
    const body = JSON.parse(String(postsOf(fetchMock).at(-1)![1].body))
    expect(body.row_data.keyKind).toBe('permanent')
  })

  // ---- Case 2: CONFIRMED ABSENCE — unchanged (regression guard) ----
  it("still returns reason 'not_registered' when the read SUCCEEDS and genuinely has no such company", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))

    const res = await claimCompanyProject('ghost', 'jwt-token')

    expect(res).toEqual({ ok: false, claimed: false, reason: 'not_registered' })
    expect(postsOf(fetchMock)).toHaveLength(0)
  })

  // ---- Case 3: UNVERIFIED LOOKUP — the #1492 fix ----
  it("reports reason 'lookup_failed', NOT 'not_registered', when the registry read itself fails", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(readFailedResponse())

    const res = await claimCompanyProject('acme', 'valid-jwt')

    expect(res.reason).toBe('lookup_failed')
    expect(res.reason).not.toBe('not_registered')
    expect(res.ok).toBe(false)
    expect(res.claimed).toBe(false)
  })

  it("reports 'lookup_failed' when the registry read REJECTS outright", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(new Error('network timeout'))

    const res = await claimCompanyProject('acme', 'valid-jwt')

    expect(res).toEqual({ ok: false, claimed: false, reason: 'lookup_failed' })
  })

  it('attempts NO external claim and NO registry write on an unverified lookup', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(readFailedResponse())

    await claimCompanyProject('acme', 'valid-jwt')

    // Nothing was written, and the founder's single-use claimToken was never
    // spent against core's /instant-db/claim on a read we couldn't complete.
    expect(postsOf(fetchMock)).toHaveLength(0)
    const claimCall = fetchMock.mock.calls.find((c: any[]) =>
      String(c[0]).includes('/instant-db/claim'),
    )
    expect(claimCall).toBeUndefined()
    expect(h.storeCompanyZerodbKey).not.toHaveBeenCalled()
  })

  // ---- The other confirmed outcomes must keep their own distinct reasons:
  // 'lookup_failed' must not become a catch-all. ----
  it('keeps every other confirmed outcome on its own distinct reason', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const cases: Array<[string, any, string, boolean]> = [
      // [label, row, expected reason, expected ok]
      ['never provisioned', row('acme'), 'not_tmp', true],
      ['already permanent', row('acme', { zerodbProjectId: 'p', keyKind: 'permanent' }), 'already_permanent', true],
      ['no claim token', row('acme', { zerodbProjectId: 'p', keyKind: 'tmp' }), 'no_claim_token', false],
    ]
    for (const [label, r, reason, ok] of cases) {
      fetchMock.mockReset()
      __resetRegistryCacheForTests()
      fetchMock.mockResolvedValueOnce(rowsResponse([r]))
      const res = await claimCompanyProject('acme', 'jwt-token')
      expect(res.reason, label).toBe(reason)
      expect(res.ok, label).toBe(ok)
    }
  })

  it("a soft-deleted company is a CONFIRMED absence ('not_registered'), not an unverified lookup", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([claimableRow('acme', { lifecycleStatus: 'deleted' })]))

    const res = await claimCompanyProject('acme', 'jwt-token')

    expect(res.reason).toBe('not_registered')
  })

  it('a CONFIRMED lookup whose external claim then fails is still its own real failure, never lookup_failed', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([claimableRow('acme')]))
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ detail: 'claim token expired' }),
    } as unknown as Response)

    const res = await claimCompanyProject('acme', 'valid-jwt')

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('claim token expired')
    expect(res.reason).not.toBe('lookup_failed')
  })
})

// =======================================
// reconcilePlanFulfillment
// =======================================
describe('reconcilePlanFulfillment unverified-lookup handling (#1492)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    h.storeCompanyZerodbKey.mockClear()
    h.storeCompanyZerodbKey.mockResolvedValue(true)
    __resetRegistryCacheForTests()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetRegistryCacheForTests()
  })

  // ---- Case 1: CONFIRMED SUCCESS — unchanged (regression guard) ----
  it('still repairs a stale plan AND claims a still-tmp_ key, with no lookupFailed flag', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // Read (shared by reconcile's own lookup + setAppPlan's, via the #1172 cache).
    fetchMock.mockResolvedValueOnce(rowsResponse([claimableRow('agentive', { plan: undefined })]))
    fetchMock.mockResolvedValueOnce(okResponse()) // setAppPlan write (invalidates cache)
    fetchMock.mockResolvedValueOnce(rowsResponse([claimableRow('agentive', { plan: 'pro' })])) // claim's lookup
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ api_key: 'sk_real' }),
    } as unknown as Response)
    fetchMock.mockResolvedValueOnce(okResponse()) // claim's write

    const res = await reconcilePlanFulfillment('agentive', 'pro', 'founders-real-jwt')

    expect(res.planFixed).toBe(true)
    expect(res.keyClaimed).toBe(true)
    expect(res.lookupFailed).toBeUndefined()
  })

  // ---- Case 2: CONFIRMED ABSENCE / NOTHING TO DO — unchanged (regression guard) ----
  it('a CONFIRMED absent company stays a bare no-op — the two-field shape is byte-identical', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))

    const res = await reconcilePlanFulfillment('ghost', 'pro', 'jwt')

    // toEqual (not a field-by-field check) is the point: `lookupFailed` must be
    // ABSENT here, so every pre-existing caller/assertion of the old two-field
    // result is untouched on this path.
    expect(res).toEqual({ planFixed: false, keyClaimed: false })
    expect(postsOf(fetchMock)).toHaveLength(0)
  })

  it('a CONFIRMED already-correct plan stays a bare no-op', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'p', keyKind: 'permanent', plan: 'pro' })]),
    )

    const res = await reconcilePlanFulfillment('acme', 'pro', 'jwt')

    expect(res).toEqual({ planFixed: false, keyClaimed: false })
  })

  it('the pure argument + paid-plan guards still short-circuit to a bare no-op, with no read at all', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(readFailedResponse())

    expect(await reconcilePlanFulfillment('', 'pro', 'jwt')).toEqual({ planFixed: false, keyClaimed: false })
    expect(await reconcilePlanFulfillment('acme', '', 'jwt')).toEqual({ planFixed: false, keyClaimed: false })
    expect(await reconcilePlanFulfillment('acme', 'pro', '')).toEqual({ planFixed: false, keyClaimed: false })
    expect(await reconcilePlanFulfillment('acme', 'hobbyist', 'jwt')).toEqual({ planFixed: false, keyClaimed: false })
    // A refusal that never consulted the registry must never claim its read failed.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ---- Case 3: UNVERIFIED LOOKUP — the #1492 fix ----
  it('flags lookupFailed when the registry read itself fails — distinguishable from a clean no-op', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(readFailedResponse())

    const res = await reconcilePlanFulfillment('agentive', 'pro', 'founders-real-jwt')

    expect(res.lookupFailed).toBe(true)
    expect(res.planFixed).toBe(false)
    expect(res.keyClaimed).toBe(false)
    // THE BUG: this used to be indistinguishable from "checked, nothing to fix."
    expect(res).not.toEqual({ planFixed: false, keyClaimed: false })
  })

  it('flags lookupFailed when the registry read REJECTS outright', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(new Error('registry unreachable'))

    const res = await reconcilePlanFulfillment('agentive', 'pro', 'jwt')

    expect(res.lookupFailed).toBe(true)
  })

  it('attempts NO plan write and NO claim on an unverified lookup', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(readFailedResponse())

    await reconcilePlanFulfillment('agentive', 'pro', 'founders-real-jwt')

    expect(postsOf(fetchMock)).toHaveLength(0)
    const claimCall = fetchMock.mock.calls.find((c: any[]) =>
      String(c[0]).includes('/instant-db/claim'),
    )
    expect(claimCall).toBeUndefined()
  })

  it('still never throws on an unverified lookup — the best-effort contract its caller relies on', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(readFailedResponse())

    // GET /api/build/subscription/status fires this as
    // `reconcilePlanFulfillment(...).catch(() => {})` on every Live load; a
    // throw here must never turn a plain dashboard load into an error.
    await expect(reconcilePlanFulfillment('agentive', 'pro', 'jwt')).resolves.toBeTruthy()
  })

  it('a CONFIRMED lookup whose plan WRITE then fails is a real write failure, never lookupFailed', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // The #1172 read cache means reconcile's own lookup and setAppPlan's share
    // ONE GET (verified by probing the real call sequence: GET, then POST), so
    // the failed write is the second mock, not the third.
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'p', keyKind: 'permanent', plan: undefined })]),
    )
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'write boom' } as unknown as Response)

    const res = await reconcilePlanFulfillment('acme', 'pro', 'jwt')

    expect(res.planFixed).toBe(false)
    expect(res.lookupFailed).toBeUndefined()
  })
})
