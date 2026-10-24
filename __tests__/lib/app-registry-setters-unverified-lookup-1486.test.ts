import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes (see app-registry-core.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import {
  setAppLogo,
  setAppEmailUndeliverable,
  setAppCommsOptOut,
  setAppDomain,
  setAppIdea,
  setAppLifecycle,
  setAppByoDomain,
  setAppZeroVoice,
  setAppCommsMode,
  setAppLastDigestAt,
  setAppWiring,
  setAppGrowthAdTest,
  setAppGrowthAdBudgetFunded,
  setAppGrowthAdInsights,
  setAppZeroInvoiceConnectClicked,
  setAppContentWorkflowTwinId,
  setAppZeroInvoiceConnectConfirmed,
  setAppOwner,
  setAppPlan,
  setAppProvisioned,
  setAppRailwayService,
  setAppGitRepo,
  RegistryLookupUnverifiedError,
  isRegistryLookupUnverified,
  __resetRegistryCacheForTests,
} from '@/lib/build/app-registry'

/**
 * #1486 — every `setApp*` setter in app-registry.ts used to resolve its target
 * with a plain `resolveApp(slug)` whose single `null` return collapses "no such
 * company" with "the registry read itself failed" (the #832 anti-pattern). A
 * transient ZeroDB hiccup therefore made every setter return `false`, which
 * every caller reports as a generic WRITE failure ("I couldn't save that
 * logo") — when in fact the write was never attempted: the READ never
 * completed.
 *
 * This suite pins all three states for all 22 setters:
 *   1. CONFIRMED SUCCESS   → unchanged (`true`, a real POST appended).
 *   2. CONFIRMED ABSENCE   → unchanged (`false`, no POST).  [regression guard]
 *   3. UNVERIFIED LOOKUP   → NEW: rejects with RegistryLookupUnverifiedError
 *                            instead of silently returning `false`.
 *
 * Cases 1 and 2 are the regression guards — the fix must not change either,
 * since every existing caller's handling of them is already correct.
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

const BASE_ROW = {
  slug: 'acme',
  chatId: 'chat-1',
  createdAt: '2026-08-01T00:00:00Z',
  name: 'Acme',
}

/**
 * Every setter under test, with arguments that are VALID (so the setter gets
 * past its own pure argument guards and actually reaches the registry lookup)
 * and a pre-existing row shaped so the setter's own idempotency short-circuit
 * does NOT fire — i.e. the confirmed-success case really does append a row.
 */
const SETTERS: Array<{
  name: string
  call: (slug: string) => Promise<boolean>
  /** Extra fields on the existing row for the confirmed-success case. */
  existing?: Record<string, unknown>
}> = [
  { name: 'setAppLogo', call: (s) => setAppLogo(s, { logoUrl: '/api/build/logo?id=f1', logoFileId: 'f1' }) },
  { name: 'setAppEmailUndeliverable', call: (s) => setAppEmailUndeliverable(s, 'hard_bounce') },
  { name: 'setAppCommsOptOut', call: (s) => setAppCommsOptOut(s, true) },
  { name: 'setAppDomain', call: (s) => setAppDomain(s, 'acme.com') },
  { name: 'setAppIdea', call: (s) => setAppIdea(s, 'a marketplace for bees') },
  { name: 'setAppLifecycle', call: (s) => setAppLifecycle(s, 'offline') },
  { name: 'setAppByoDomain', call: (s) => setAppByoDomain(s, { domain: 'acme.dev', byoDomainId: 'd1', status: 'pending' }) },
  { name: 'setAppZeroVoice', call: (s) => setAppZeroVoice(s, { numberId: 'n1', e164: '+15555550123' }) },
  { name: 'setAppCommsMode', call: (s) => setAppCommsMode(s, 'pairProgramming') },
  { name: 'setAppLastDigestAt', call: (s) => setAppLastDigestAt(s, '2026-10-24T09:00:00Z') },
  { name: 'setAppWiring', call: (s) => setAppWiring(s, { pipelineWired: true }) },
  { name: 'setAppGrowthAdTest', call: (s) => setAppGrowthAdTest(s, { campaignId: 'camp-1' }) },
  {
    name: 'setAppGrowthAdBudgetFunded',
    call: (s) => setAppGrowthAdBudgetFunded(s, { paymentIntentId: 'pi_1', requestedCents: 10_000, realCents: 8_000 }),
  },
  { name: 'setAppGrowthAdInsights', call: (s) => setAppGrowthAdInsights(s, { clicks: 42, cpcCents: 55 }) },
  { name: 'setAppZeroInvoiceConnectClicked', call: (s) => setAppZeroInvoiceConnectClicked(s) },
  { name: 'setAppContentWorkflowTwinId', call: (s) => setAppContentWorkflowTwinId(s, 'twin-1') },
  { name: 'setAppZeroInvoiceConnectConfirmed', call: (s) => setAppZeroInvoiceConnectConfirmed(s) },
  { name: 'setAppOwner', call: (s) => setAppOwner(s, 'founder@example.com') },
  { name: 'setAppPlan', call: (s) => setAppPlan(s, 'pro') },
  { name: 'setAppProvisioned', call: (s) => setAppProvisioned(s, { zerodbProjectId: 'proj-1', keyKind: 'permanent' }) },
  { name: 'setAppRailwayService', call: (s) => setAppRailwayService(s, { railwayServiceId: 'svc-1' }) },
  { name: 'setAppGitRepo', call: (s) => setAppGitRepo(s, { gitRepoUrl: 'https://git/x.git', gitRepoId: '7', gitOrg: 'org' }) },
]

describe('setApp* unverified-lookup handling (#1486)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    __resetRegistryCacheForTests()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetRegistryCacheForTests()
  })

  it('exports a distinct, identifiable error type for an unverified lookup', () => {
    const err = new RegistryLookupUnverifiedError('setAppLogo', 'acme')
    expect(isRegistryLookupUnverified(err)).toBe(true)
    expect(err.slug).toBe('acme')
    expect(err.setter).toBe('setAppLogo')
    expect(err.message).toContain('[app-registry] registry lookup unverified')
    // Must NOT swallow unrelated errors into the same bucket.
    expect(isRegistryLookupUnverified(new Error('boom'))).toBe(false)
    expect(isRegistryLookupUnverified(null)).toBe(false)
  })

  for (const { name, call, existing } of SETTERS) {
    describe(name, () => {
      // ---- Case 1: CONFIRMED SUCCESS — unchanged (regression guard) ----
      it('still returns true and appends a row when the company is confirmed present', async () => {
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
        fetchMock.mockResolvedValueOnce(rowsResponse([{ ...BASE_ROW, ...(existing || {}) }]))
        fetchMock.mockResolvedValueOnce(okResponse())

        await expect(call('acme')).resolves.toBe(true)

        const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
        expect(postCall).toBeDefined()
        const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
        // The existing entry is carried forward, never clobbered.
        expect(body.row_data.slug).toBe('acme')
        expect(body.row_data.chatId).toBe('chat-1')
      })

      // ---- Case 2: CONFIRMED ABSENCE — unchanged (regression guard) ----
      it('still returns false (no POST) when the company is confirmed absent', async () => {
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
        // A real, successful read that genuinely contains no such slug →
        // resolveAppVerified reports { entry: null, verified: true }.
        fetchMock.mockResolvedValueOnce(rowsResponse([]))

        await expect(call('ghost')).resolves.toBe(false)

        const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
        expect(postCall).toBeUndefined()
      })

      // ---- Case 3: UNVERIFIED LOOKUP — the #1486 fix ----
      it('throws RegistryLookupUnverifiedError (never a silent false) when the read itself fails', async () => {
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
        fetchMock.mockResolvedValue(readFailedResponse())

        await expect(call('acme')).rejects.toThrow(RegistryLookupUnverifiedError)

        // And it never attempted the write it was being blamed for.
        const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
        expect(postCall).toBeUndefined()
      })

      it('throws RegistryLookupUnverifiedError when the read REJECTS outright', async () => {
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
        fetchMock.mockRejectedValue(new Error('network timeout'))

        const err = await call('acme').then(
          () => null,
          (e: unknown) => e,
        )
        expect(isRegistryLookupUnverified(err)).toBe(true)
        expect((err as RegistryLookupUnverifiedError).setter).toBe(name)
        expect((err as RegistryLookupUnverifiedError).slug).toBe('acme')
      })
    })
  }

  // ---- The setters' own pure argument guards must still short-circuit BEFORE
  // the lookup, so an invalid argument is still a plain `false` (never a
  // thrown unverified-lookup error) and costs no registry read at all. ----
  describe('pure argument guards run before the lookup (unchanged)', () => {
    const guarded: Array<[string, () => Promise<boolean>]> = [
      ['setAppLogo (empty logoUrl)', () => setAppLogo('acme', { logoUrl: '  ' })],
      ['setAppByoDomain (empty domain)', () => setAppByoDomain('acme', { domain: '' })],
      ['setAppZeroVoice (missing e164)', () => setAppZeroVoice('acme', { numberId: 'n1', e164: '' })],
      ['setAppCommsMode (invalid mode)', () => setAppCommsMode('acme', 'nope' as any)],
      ['setAppLastDigestAt (empty iso)', () => setAppLastDigestAt('acme', '')],
      ['setAppGrowthAdTest (empty campaignId)', () => setAppGrowthAdTest('acme', { campaignId: '' })],
      [
        'setAppGrowthAdBudgetFunded (empty paymentIntentId)',
        () => setAppGrowthAdBudgetFunded('acme', { paymentIntentId: '', requestedCents: 1, realCents: 1 }),
      ],
      ['setAppOwner (empty email)', () => setAppOwner('acme', '   ')],
      ['setAppRailwayService (empty serviceId)', () => setAppRailwayService('acme', { railwayServiceId: '' })],
      [
        'setAppGitRepo (missing gitOrg)',
        () => setAppGitRepo('acme', { gitRepoUrl: 'https://git/x.git', gitRepoId: '7', gitOrg: '' }),
      ],
    ]

    for (const [label, call] of guarded) {
      it(`${label} → false with no fetch at all`, async () => {
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
        // Even if the registry WOULD fail, the guard must win first.
        fetchMock.mockResolvedValue(readFailedResponse())
        await expect(call()).resolves.toBe(false)
        expect(fetchMock).not.toHaveBeenCalled()
      })
    }
  })

  // ---- A soft-deleted company is a CONFIRMED absence (resolveAppVerified's
  // own contract), not an unverified lookup — must stay a plain `false`. ----
  it('treats a soft-deleted company as a confirmed absence (false), not an unverified lookup', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([{ ...BASE_ROW, lifecycleStatus: 'deleted' }]))
    await expect(setAppDomain('acme', 'acme.com')).resolves.toBe(false)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  // ---- A read that SUCCEEDS but whose WRITE fails is still a genuine write
  // failure: plain `false`, never the unverified-lookup error. The whole point
  // of #1486 is keeping those two apart. ----
  it('a confirmed lookup followed by a failed WRITE is still a plain false (a real write failure)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([BASE_ROW]))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'write boom' } as unknown as Response)
    await expect(setAppDomain('acme', 'acme.com')).resolves.toBe(false)
  })
})
