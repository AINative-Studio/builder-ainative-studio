import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Enrollment-ownerKey backfill sweep (#2114) — the retroactive half of
 * #2111/#2113. See lib/build/loop-enrollment-backfill.ts's doc comment for
 * the full incident history. Mirrors
 * __tests__/lib/build/metadata-backfill.test.ts's harness conventions
 * (vi.doMock + dynamic import, since the module under test imports real
 * dependencies at module scope).
 */

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

interface FakeApp {
  slug: string
  ownerEmail?: string
  lifecycleStatus?: string
}

async function load(opts: {
  apps: FakeApp[]
  registryOk?: boolean
  syncResults?: Record<string, boolean | Error>
}) {
  const listAllAppsWithStatus = vi.fn(async () => ({
    apps: opts.apps,
    ok: opts.registryOk !== false,
  }))
  const syncEnrollmentOwnerKey = vi.fn(async (slug: string, _ownerKey: string) => {
    const r = (opts.syncResults || {})[slug]
    if (r instanceof Error) throw r
    return r === undefined ? true : r
  })

  vi.doMock('@/lib/build/app-registry', () => ({ listAllAppsWithStatus }))
  vi.doMock('@/lib/build/loop-enrollment', () => ({ syncEnrollmentOwnerKey }))

  const mod = await import('@/lib/build/loop-enrollment-backfill')
  return { ...mod, syncEnrollmentOwnerKey, listAllAppsWithStatus }
}

describe('runOwnerKeyBackfillSweep', () => {
  it('fails closed and reports registryOk:false when the registry read fails, without syncing anything', async () => {
    const { runOwnerKeyBackfillSweep, syncEnrollmentOwnerKey } = await load({
      apps: [],
      registryOk: false,
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false })
    expect(result.registryOk).toBe(false)
    expect(result.checked).toBe(0)
    expect(syncEnrollmentOwnerKey).not.toHaveBeenCalled()
  })

  it('skips deleted companies entirely', async () => {
    const { runOwnerKeyBackfillSweep, syncEnrollmentOwnerKey } = await load({
      apps: [{ slug: 'ghost', ownerEmail: 'a@b.com', lifecycleStatus: 'deleted' }],
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false })
    expect(result.checked).toBe(0)
    expect(syncEnrollmentOwnerKey).not.toHaveBeenCalled()
    expect(result.byDisposition).toEqual({})
  })

  it('records no_owner_email and never calls sync for a company with no resolvable owner', async () => {
    const { runOwnerKeyBackfillSweep, syncEnrollmentOwnerKey } = await load({
      apps: [{ slug: 'anon-co' }],
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false })
    expect(result.checked).toBe(0)
    expect(result.byDisposition).toEqual({ no_owner_email: 1 })
    expect(syncEnrollmentOwnerKey).not.toHaveBeenCalled()
  })

  it('dry run never calls syncEnrollmentOwnerKey, but still counts eligible companies', async () => {
    const { runOwnerKeyBackfillSweep, syncEnrollmentOwnerKey } = await load({
      apps: [
        { slug: 'wrench', ownerEmail: 'founder@wrench.com' },
        { slug: 'tidemark', ownerEmail: 'founder@tidemark.com' },
      ],
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: true })
    expect(result.dryRun).toBe(true)
    expect(result.checked).toBe(2)
    expect(result.byDisposition).toEqual({ would_sync: 2 })
    expect(syncEnrollmentOwnerKey).not.toHaveBeenCalled()
  })

  it('real run calls syncEnrollmentOwnerKey with the normalized owner email and counts successes', async () => {
    const { runOwnerKeyBackfillSweep, syncEnrollmentOwnerKey } = await load({
      apps: [{ slug: 'wrench', ownerEmail: '  Founder@Wrench.com  ' }],
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false })
    expect(syncEnrollmentOwnerKey).toHaveBeenCalledWith('wrench', 'founder@wrench.com')
    expect(result.synced).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.byDisposition).toEqual({ synced: 1 })
    expect(result.results[0]).toEqual({ slug: 'wrench', disposition: 'synced', ownerEmail: 'founder@wrench.com' })
  })

  it('real run counts a false return from syncEnrollmentOwnerKey as sync_failed, never silently', async () => {
    const { runOwnerKeyBackfillSweep } = await load({
      apps: [{ slug: 'wrench', ownerEmail: 'founder@wrench.com' }],
      syncResults: { wrench: false },
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false })
    expect(result.synced).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.byDisposition).toEqual({ sync_failed: 1 })
  })

  it('real run treats a thrown error from syncEnrollmentOwnerKey as sync_failed, not a crash', async () => {
    const { runOwnerKeyBackfillSweep } = await load({
      apps: [{ slug: 'wrench', ownerEmail: 'founder@wrench.com' }],
      syncResults: { wrench: new Error('network blew up') },
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false })
    expect(result.failed).toBe(1)
    expect(result.byDisposition).toEqual({ sync_failed: 1 })
  })

  it('--only scopes the sweep to the named slug(s), skipping every other company', async () => {
    const { runOwnerKeyBackfillSweep, syncEnrollmentOwnerKey } = await load({
      apps: [
        { slug: 'wrench', ownerEmail: 'founder@wrench.com' },
        { slug: 'tidemark', ownerEmail: 'founder@tidemark.com' },
        { slug: 'beacon', ownerEmail: 'founder@beacon.com' },
      ],
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false, onlySlugs: ['tidemark'] })
    expect(result.checked).toBe(1)
    expect(syncEnrollmentOwnerKey).toHaveBeenCalledTimes(1)
    expect(syncEnrollmentOwnerKey).toHaveBeenCalledWith('tidemark', 'founder@tidemark.com')
  })

  it('a mixed run reports per-company dispositions independently, one failure does not mask another success', async () => {
    const { runOwnerKeyBackfillSweep } = await load({
      apps: [
        { slug: 'wrench', ownerEmail: 'founder@wrench.com' },
        { slug: 'tidemark', ownerEmail: 'founder@tidemark.com' },
        { slug: 'anon-co' },
      ],
      syncResults: { tidemark: false },
    })
    const result = await runOwnerKeyBackfillSweep({ dryRun: false })
    expect(result.checked).toBe(2)
    expect(result.synced).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.byDisposition).toEqual({ synced: 1, sync_failed: 1, no_owner_email: 1 })
  })
})
