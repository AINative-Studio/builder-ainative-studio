import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import {
  setAppLogo,
  setAppDomain,
  setAppLifecycle,
  setAppOwner,
  setAppPlan,
  setAppCommsMode,
  setAppGitRepo,
  setAppRailwayService,
  setAppProvisioned,
  claimCompanyProject,
  reconcilePlanFulfillment,
  __resetRegistryCacheForTests,
} from '@/lib/build/app-registry'

/**
 * #1486 (#832-class) — all ~24 `setApp*` setters in app-registry.ts shared the
 * shape
 *
 *     const existing = await resolveApp(slug)
 *     if (!existing) return false
 *
 * and `resolveApp()`'s single `null` collapses "no such company" with "the
 * registry read itself failed." A transient ZeroDB hiccup therefore made every
 * setter return `false`, reported up to the caller as a generic WRITE failure
 * ("I couldn't save that logo") when the write was never even attempted.
 *
 * These tests prove, per triage group:
 *   1. the CONFIRMED-ABSENT case still behaves exactly as before (no
 *      regression for any existing caller), and
 *   2. the UNVERIFIED (transient-read-failure) case is now distinguishable —
 *      either via a richer return value (groups A/B) or via a verifiable
 *      server-side log call (groups C/D), and
 *   3. no setter ever WRITES on an unverified lookup (the safe no-op property
 *      the issue relies on is preserved, not traded away for honesty).
 */

/** A successful rows read returning the given registry rows. */
function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
/** A FAILED rows read — the transient hiccup this issue is about. */
function failedRead(): Response {
  return { ok: false, status: 503, text: async () => 'upstream unavailable' } as unknown as Response
}
function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

const ROW = { slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>
}
/** Did any POST (i.e. a real registry write) happen? */
function didWrite(): boolean {
  return fetchMock().mock.calls.some((c: any[]) => c[1]?.method === 'POST')
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  __resetRegistryCacheForTests()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __resetRegistryCacheForTests()
})

/** The log line resolveAppForWrite emits, naming the setter whose write was skipped. */
function warnedFor(op: string): boolean {
  return warnSpy.mock.calls.some(
    (c) => String(c[0]).includes('[app-registry]') && String(c[0]).includes(op) && String(c[0]).includes('lookup FAILED'),
  )
}

/* ------------------------------------------------------------------ *
 * GROUP A — richer return. setAppLogo's boolean IS a founder-facing
 * message (POST /api/build/logo echoes it as `saved`), and it has exactly
 * one production caller, so widening it was trivial and in scope.
 * ------------------------------------------------------------------ */
describe('#1486 group A — richer return (setAppLogo)', () => {
  it('confirmed-absent company → ok:false, reason not_registered (same refusal as before)', async () => {
    fetchMock().mockResolvedValueOnce(rowsResponse([]))
    const res = await setAppLogo('ghost', { logoUrl: '/api/build/logo?id=abc' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('not_registered')
    expect(didWrite()).toBe(false)
  })

  it('TRANSIENT read failure → ok:false but reason lookup_failed (now distinguishable)', async () => {
    fetchMock().mockResolvedValueOnce(failedRead())
    const res = await setAppLogo('acme', { logoUrl: '/api/build/logo?id=abc' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('lookup_failed')
    // Still the SAFE no-op the issue describes: nothing was written.
    expect(didWrite()).toBe(false)
    expect(warnedFor('setAppLogo')).toBe(true)
  })

  it('a thrown read (not just !ok) is also lookup_failed, never not_registered', async () => {
    fetchMock().mockRejectedValueOnce(new Error('socket hang up'))
    const res = await setAppLogo('acme', { logoUrl: '/api/build/logo?id=abc' })
    expect(res.reason).toBe('lookup_failed')
    expect(didWrite()).toBe(false)
  })

  it('happy path still writes and reports ok (no regression)', async () => {
    fetchMock().mockResolvedValueOnce(rowsResponse([ROW])).mockResolvedValueOnce(okResponse())
    const res = await setAppLogo('acme', { logoUrl: '/api/build/logo?id=abc', logoFileId: 'abc' })
    expect(res.ok).toBe(true)
    expect(res.reason).toBeUndefined()
    expect(didWrite()).toBe(true)
  })

  it('a real WRITE failure is reported as write_failed, not as a lookup problem', async () => {
    fetchMock()
      .mockResolvedValueOnce(rowsResponse([ROW]))
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'nope' } as unknown as Response)
    const res = await setAppLogo('acme', { logoUrl: '/api/build/logo?id=abc' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('write_failed')
  })
})

/* ------------------------------------------------------------------ *
 * GROUP B — already-richer return. claimCompanyProject already returned
 * { ok, claimed, reason?: string } that callers only log, so adding
 * 'lookup_failed' breaks no contract.
 * ------------------------------------------------------------------ */
describe('#1486 group B — already-richer return (claimCompanyProject)', () => {
  it('confirmed-absent → reason not_registered (unchanged)', async () => {
    fetchMock().mockResolvedValueOnce(rowsResponse([]))
    const res = await claimCompanyProject('ghost', 'jwt-x')
    expect(res.ok).toBe(false)
    expect(res.claimed).toBe(false)
    expect(res.reason).toBe('not_registered')
  })

  it('TRANSIENT read failure → reason lookup_failed, not a false not_registered', async () => {
    fetchMock().mockResolvedValueOnce(failedRead())
    const res = await claimCompanyProject('acme', 'jwt-x')
    expect(res.ok).toBe(false)
    expect(res.claimed).toBe(false)
    expect(res.reason).toBe('lookup_failed')
    expect(didWrite()).toBe(false)
    expect(warnedFor('claimCompanyProject')).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * GROUP C — callers already pre-verify with resolveAppVerified() and fail
 * closed with a 503 before ever calling in, so the setter's own boolean
 * never reaches a human. Log-only; boolean contract deliberately unchanged.
 * ------------------------------------------------------------------ */
describe('#1486 group C — log-only, caller pre-verifies (boolean contract unchanged)', () => {
  const cases: Array<[string, () => Promise<boolean>]> = [
    ['setAppCommsMode', () => setAppCommsMode('acme', 'agile')],
    ['setAppLifecycle', () => setAppLifecycle('acme', 'offline')],
    ['setAppDomain', () => setAppDomain('acme', 'acme.com')],
  ]

  for (const [op, call] of cases) {
    it(`${op}: confirmed-absent still returns false (identical to before)`, async () => {
      fetchMock().mockResolvedValueOnce(rowsResponse([]))
      expect(await call()).toBe(false)
      expect(didWrite()).toBe(false)
    })

    it(`${op}: transient read failure returns false AND logs the distinction`, async () => {
      fetchMock().mockResolvedValueOnce(failedRead())
      expect(await call()).toBe(false)
      expect(didWrite()).toBe(false)
      expect(warnedFor(op)).toBe(true)
    })
  }

  it('a confirmed-absent company does NOT emit the lookup-failed warning', async () => {
    fetchMock().mockResolvedValueOnce(rowsResponse([]))
    await setAppLifecycle('ghost', 'deleted')
    expect(warnedFor('setAppLifecycle')).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * GROUP D — fire-and-forget best-effort callers (`.catch(() => {})`), plus
 * the internal/backfill setters. Log-only, same reasoning as group C.
 * ------------------------------------------------------------------ */
describe('#1486 group D — log-only, fire-and-forget callers', () => {
  const cases: Array<[string, () => Promise<boolean>]> = [
    ['setAppOwner', () => setAppOwner('acme', 'founder@x.com')],
    ['setAppPlan', () => setAppPlan('acme', 'pro')],
    ['setAppGitRepo', () => setAppGitRepo('acme', { gitRepoUrl: 'u', gitRepoId: 'i', gitOrg: 'o' })],
    ['setAppRailwayService', () => setAppRailwayService('acme', { railwayServiceId: 'svc-1' })],
    ['setAppProvisioned', () => setAppProvisioned('acme', { zerodbProjectId: 'p-1' })],
  ]

  for (const [op, call] of cases) {
    it(`${op}: confirmed-absent still returns false, writes nothing`, async () => {
      fetchMock().mockResolvedValueOnce(rowsResponse([]))
      expect(await call()).toBe(false)
      expect(didWrite()).toBe(false)
    })

    it(`${op}: transient read failure returns false, writes nothing, and logs it`, async () => {
      fetchMock().mockResolvedValueOnce(failedRead())
      expect(await call()).toBe(false)
      expect(didWrite()).toBe(false)
      expect(warnedFor(op)).toBe(true)
    })
  }

  it('reconcilePlanFulfillment stays silent to its caller but logs the distinction', async () => {
    fetchMock().mockResolvedValueOnce(failedRead())
    const res = await reconcilePlanFulfillment('acme', 'pro', 'jwt-x')
    // Contract unchanged — deliberately silent/best-effort (runs on every
    // dashboard load; must never turn a page load into a visible error).
    expect(res).toEqual({ planFixed: false, keyClaimed: false })
    expect(didWrite()).toBe(false)
    expect(warnedFor('reconcilePlanFulfillment')).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * Cross-group invariant: the log line must name the setter, so an operator
 * reading production logs knows WHICH write a hiccup silently skipped.
 * ------------------------------------------------------------------ */
describe('#1486 — the log identifies the skipped write', () => {
  it('names both the setter and the slug', async () => {
    fetchMock().mockResolvedValueOnce(failedRead())
    await setAppOwner('habanero-hub', 'founder@x.com')
    const line = warnSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('setAppOwner'))
    expect(line).toBeTruthy()
    expect(line).toContain('habanero-hub')
    expect(line).toMatch(/lookup FAILED/)
  })
})
