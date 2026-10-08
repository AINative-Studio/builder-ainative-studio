/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1015 — the real, wired trigger for server-side registration reconciliation.
 *
 * A standalone CRON_SECRET-gated endpoint under /api/cron/* (the prefix
 * middleware.ts already allowlists, with the handler itself as the auth
 * boundary), mirroring app/api/cron/loop-backfill: a real run requires BOTH the
 * secret AND an explicit `?send=true`, so a routine cron ping, a health probe
 * or a mistaken curl can only ever perform a dry run. That matters here because
 * a real run pushes commits to real customer repos.
 */

const runRegistrationReconcileSweep = vi.fn()

vi.mock('@/lib/build/registration-reconcile', () => ({
  runRegistrationReconcileSweep: (...a: unknown[]) => runRegistrationReconcileSweep(...a),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET, POST } from '@/app/api/cron/reconcile-registration/route'

function req(url: string, authorization?: string) {
  return {
    url,
    nextUrl: new URL(url),
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? authorization ?? null : null) },
  } as never
}

const BASE = 'https://builder.ainative.studio/api/cron/reconcile-registration'

function sweep(extra: Record<string, unknown> = {}) {
  return {
    ok: true, dryRun: true, registryOk: true, total: 3, candidates: 1,
    reconciled: 0, committed: 0, skipped: 3, byDisposition: { stuck: 1 }, results: [],
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'secret-123'
  runRegistrationReconcileSweep.mockResolvedValue(sweep())
})

describe('GET /api/cron/reconcile-registration', () => {
  it('rejects a request without the cron secret', async () => {
    const res = await GET(req(BASE))

    expect(res.status).toBe(401)
    expect(runRegistrationReconcileSweep).not.toHaveBeenCalled()
  })

  it('rejects a wrong cron secret', async () => {
    const res = await GET(req(BASE, 'Bearer nope'))

    expect(res.status).toBe(401)
    expect(runRegistrationReconcileSweep).not.toHaveBeenCalled()
  })

  it('DRY-RUNS by default even with a valid secret — a cron ping must never push commits', async () => {
    const res = await GET(req(BASE, 'Bearer secret-123'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runRegistrationReconcileSweep).toHaveBeenCalledWith({ dryRun: true, slug: undefined })
    expect(body.dryRun).toBe(true)
    expect(body.candidates).toBe(1)
  })

  it('performs a REAL run only with both the secret and an explicit ?send=true', async () => {
    runRegistrationReconcileSweep.mockResolvedValue(
      sweep({ dryRun: false, reconciled: 1, committed: 1 }),
    )

    const res = await GET(req(`${BASE}?send=true`, 'Bearer secret-123'))
    const body = await res.json()

    expect(runRegistrationReconcileSweep).toHaveBeenCalledWith({ dryRun: false, slug: undefined })
    expect(body.dryRun).toBe(false)
    expect(body.reconciled).toBe(1)
  })

  it('passes a ?slug= through so one company can be reconciled on its own', async () => {
    await GET(req(`${BASE}?send=true&slug=flo`, 'Bearer secret-123'))

    expect(runRegistrationReconcileSweep).toHaveBeenCalledWith({ dryRun: false, slug: 'flo' })
  })

  it('returns 503 — never a clean "0 reconciled" success — when the registry read failed', async () => {
    runRegistrationReconcileSweep.mockResolvedValue(sweep({ registryOk: false }))

    const res = await GET(req(BASE, 'Bearer secret-123'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toMatch(/registry/i)
  })

  it('returns 500 when the sweep itself throws', async () => {
    runRegistrationReconcileSweep.mockRejectedValue(new Error('boom'))

    const res = await GET(req(BASE, 'Bearer secret-123'))

    expect(res.status).toBe(500)
  })

  it('POST behaves identically to GET, for cron schedulers that POST', async () => {
    const res = await POST(req(`${BASE}?send=true`, 'Bearer secret-123'))

    expect(res.status).toBe(200)
    expect(runRegistrationReconcileSweep).toHaveBeenCalledWith({ dryRun: false, slug: undefined })
  })
})
