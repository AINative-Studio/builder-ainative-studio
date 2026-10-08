import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1013 — one-shot backfill sweep for companies provisioned BEFORE #806.
 *
 * THE BUG: `/api/db` fails closed (502 KEY_UNAVAILABLE) for any company whose
 * per-company ZeroDB data-plane key was never written to
 * `builder_company_zerodb_keys`. Confirmed live for `agentive`; a registry-wide
 * audit found ~17 of 31 historically-provisioned projects affected — every one
 * of them predating #806 (merged 2026-09-22), which fixed the forward-going
 * path. So this is unbackfilled historical data, not an ongoing bug, and the
 * repair is a one-shot sweep rather than a recurring job.
 *
 * The invariants these tests protect:
 *  - A company that ALREADY has a stored key is skipped (idempotent, no churn
 *    row, no needless key mint).
 *  - A company missing one gets a REAL, project-scoped key minted and handed to
 *    storeCompanyZerodbKey() with the right arguments.
 *  - A company whose underlying ZeroDB project no longer exists / is not
 *    accessible is REPORTED as a failure — never silently swallowed, never
 *    crashed on, and never papered over with a fabricated key.
 *  - A failed registry read is never reported as "zero companies to fix"
 *    (core#7395's exact failure mode).
 *  - Dry run is the default: an accidental call mints nothing and writes nothing.
 */

const REGISTRY_PROJECT = 'builder-registry-project'

beforeEach(() => {
  vi.resetModules()
  process.env.ZERODB_API_KEY = 'shared-service-key'
  process.env.ZERODB_PROJECT_ID = REGISTRY_PROJECT
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

interface FakeApp {
  slug: string
  chatId?: string
  zerodbProjectId?: string
  provisionedAt?: string
  keyKind?: 'tmp' | 'permanent'
  lifecycleStatus?: string
  createdAt?: string
}

/**
 * Mock the three real seams the sweep depends on, then load it. Everything
 * else (the decision logic under test) runs for real.
 */
async function load(opts: {
  apps: FakeApp[]
  registryOk?: boolean
  /** projectIds that already have a stored key. */
  stored?: string[]
  /** Throw from the has-key read for these projectIds (unverifiable state). */
  hasKeyThrows?: string[]
  /** projectId → minted key, or absent to simulate "project gone / access denied". */
  mint?: Record<string, string | null>
  /** projectIds whose storeCompanyZerodbKey write should fail. */
  storeFails?: string[]
}) {
  const hasCompanyZerodbKey = vi.fn(async (projectId: string) => {
    if ((opts.hasKeyThrows || []).includes(projectId)) throw new Error('lookup blew up')
    return (opts.stored || []).includes(projectId)
  })
  const storeCompanyZerodbKey = vi.fn(async (projectId: string) => {
    return !(opts.storeFails || []).includes(projectId)
  })
  const mintProjectScopedKey = vi.fn(async (projectId: string) => {
    const key = (opts.mint || {})[projectId]
    if (key) return { ok: true as const, apiKey: key }
    return { ok: false as const, reason: 'project_not_found', status: 404 }
  })
  const listAllAppsWithStatus = vi.fn(async () => ({
    apps: opts.apps,
    ok: opts.registryOk !== false,
  }))

  vi.doMock('@/lib/build/company-zerodb-credentials', () => ({
    hasCompanyZerodbKey,
    storeCompanyZerodbKey,
    mintProjectScopedKey,
  }))
  vi.doMock('@/lib/build/app-registry', () => ({ listAllAppsWithStatus }))

  const mod = await import('@/lib/build/zerodb-key-backfill')
  return { ...mod, hasCompanyZerodbKey, storeCompanyZerodbKey, mintProjectScopedKey, listAllAppsWithStatus }
}

describe('runZerodbKeyBackfillSweep — skipping companies that are already fine', () => {
  it('skips a company that ALREADY has a stored key: no mint, no write', async () => {
    const { runZerodbKeyBackfillSweep, mintProjectScopedKey, storeCompanyZerodbKey } = await load({
      apps: [{ slug: 'castlo', zerodbProjectId: 'proj-castlo', provisionedAt: '2026-09-23T10:00:00.000Z' }],
      stored: ['proj-castlo'],
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(1)
    expect(r.missing).toBe(0)
    expect(r.backfilled).toBe(0)
    expect(r.failed).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'castlo', disposition: 'already_stored' })
    // The real idempotency property — a re-run must not mint a second key.
    expect(mintProjectScopedKey).not.toHaveBeenCalled()
    expect(storeCompanyZerodbKey).not.toHaveBeenCalled()
  })

  it('skips a company that was never provisioned (no zerodbProjectId) — nothing to key', async () => {
    const { runZerodbKeyBackfillSweep, hasCompanyZerodbKey } = await load({
      apps: [{ slug: 'never-provisioned' }],
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.results[0]).toMatchObject({ slug: 'never-provisioned', disposition: 'not_provisioned' })
    expect(r.missing).toBe(0)
    expect(hasCompanyZerodbKey).not.toHaveBeenCalled()
  })

  it('skips a soft-deleted company — a founder deleted it, do not mint keys for it', async () => {
    const { runZerodbKeyBackfillSweep, hasCompanyZerodbKey } = await load({
      apps: [{ slug: 'gone', zerodbProjectId: 'proj-gone', lifecycleStatus: 'deleted' }],
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(hasCompanyZerodbKey).not.toHaveBeenCalled()
  })
})

describe('runZerodbKeyBackfillSweep — repairing a missing key', () => {
  it('mints a project-scoped key and stores it with the right arguments', async () => {
    const { runZerodbKeyBackfillSweep, mintProjectScopedKey, storeCompanyZerodbKey } = await load({
      apps: [
        {
          slug: 'agentive',
          zerodbProjectId: 'f17d948d-c066-426a-bcb8-238b0ef6d3b1',
          provisionedAt: '2026-09-21T23:18:00.000Z',
          keyKind: 'permanent',
        },
      ],
      stored: [],
      mint: { 'f17d948d-c066-426a-bcb8-238b0ef6d3b1': 'sk_real_minted_key' },
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(1)
    expect(r.missing).toBe(1)
    expect(r.backfilled).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.results[0]).toMatchObject({
      slug: 'agentive',
      projectId: 'f17d948d-c066-426a-bcb8-238b0ef6d3b1',
      disposition: 'backfilled',
    })

    expect(mintProjectScopedKey).toHaveBeenCalledWith(
      'f17d948d-c066-426a-bcb8-238b0ef6d3b1',
      expect.objectContaining({ slug: 'agentive' }),
    )
    expect(storeCompanyZerodbKey).toHaveBeenCalledWith(
      'f17d948d-c066-426a-bcb8-238b0ef6d3b1',
      'sk_real_minted_key',
      { slug: 'agentive', keyKind: 'permanent' },
    )
  })

  it('records the minted key as permanent even when the registry row still says tmp — a freshly minted key is not the original 72h trial key', async () => {
    const { runZerodbKeyBackfillSweep, storeCompanyZerodbKey } = await load({
      apps: [{ slug: 'trialco', zerodbProjectId: 'proj-trial', keyKind: 'tmp' }],
      mint: { 'proj-trial': 'sk_minted_for_trial' },
    })

    await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(storeCompanyZerodbKey).toHaveBeenCalledWith('proj-trial', 'sk_minted_for_trial', {
      slug: 'trialco',
      keyKind: 'permanent',
    })
  })

  it('reports a FAILURE (never silently swallows, never crashes) when the project lookup fails — its ZeroDB project is gone', async () => {
    const { runZerodbKeyBackfillSweep, storeCompanyZerodbKey } = await load({
      apps: [{ slug: 'vanished', zerodbProjectId: 'proj-deleted-upstream' }],
      mint: {},
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.ok).toBe(true) // the sweep itself completed
    expect(r.missing).toBe(1)
    expect(r.backfilled).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.results[0]).toMatchObject({
      slug: 'vanished',
      disposition: 'mint_failed',
      reason: 'project_not_found',
    })
    // Never fabricate a key for a project we could not reach.
    expect(storeCompanyZerodbKey).not.toHaveBeenCalled()
  })

  it('reports a FAILURE when the key was minted but the store write failed — the company is still broken, do not claim success', async () => {
    const { runZerodbKeyBackfillSweep } = await load({
      apps: [{ slug: 'writefail', zerodbProjectId: 'proj-writefail' }],
      mint: { 'proj-writefail': 'sk_minted_ok' },
      storeFails: ['proj-writefail'],
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.backfilled).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.results[0]).toMatchObject({ slug: 'writefail', disposition: 'store_failed' })
  })

  it('fails CLOSED when the has-key read itself throws — never mints over a key that may already exist', async () => {
    const { runZerodbKeyBackfillSweep, mintProjectScopedKey } = await load({
      apps: [{ slug: 'flaky', zerodbProjectId: 'proj-flaky' }],
      hasKeyThrows: ['proj-flaky'],
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.results[0]).toMatchObject({ slug: 'flaky', disposition: 'unverifiable' })
    expect(r.failed).toBe(1)
    expect(r.backfilled).toBe(0)
    expect(mintProjectScopedKey).not.toHaveBeenCalled()
  })
})

describe('runZerodbKeyBackfillSweep — safety', () => {
  it('is DRY RUN by default: an accidental call with no options mints nothing and writes nothing', async () => {
    const { runZerodbKeyBackfillSweep, mintProjectScopedKey, storeCompanyZerodbKey } = await load({
      apps: [{ slug: 'agentive', zerodbProjectId: 'proj-agentive' }],
      mint: { 'proj-agentive': 'sk_would_be_minted' },
    })

    const r = await runZerodbKeyBackfillSweep()

    expect(r.dryRun).toBe(true)
    expect(r.missing).toBe(1)
    expect(r.backfilled).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'agentive', disposition: 'would_backfill' })
    expect(mintProjectScopedKey).not.toHaveBeenCalled()
    expect(storeCompanyZerodbKey).not.toHaveBeenCalled()
  })

  it('never reports a FAILED registry read as "zero companies to fix" (core#7395)', async () => {
    const { runZerodbKeyBackfillSweep, hasCompanyZerodbKey } = await load({
      apps: [],
      registryOk: false,
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(r.registryOk).toBe(false)
    expect(r.checked).toBe(0)
    expect(hasCompanyZerodbKey).not.toHaveBeenCalled()
  })

  it('caps real writes per run so a filter bug cannot mint keys for the whole registry', async () => {
    const apps: FakeApp[] = []
    const mint: Record<string, string> = {}
    for (let i = 0; i < 60; i++) {
      apps.push({ slug: `co-${i}`, zerodbProjectId: `proj-${i}` })
      mint[`proj-${i}`] = `sk_${i}`
    }
    const { runZerodbKeyBackfillSweep, storeCompanyZerodbKey, MAX_BACKFILLS_PER_RUN } = await load({ apps, mint })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false })

    expect(MAX_BACKFILLS_PER_RUN).toBeGreaterThan(0)
    expect(r.backfilled).toBe(MAX_BACKFILLS_PER_RUN)
    expect(storeCompanyZerodbKey).toHaveBeenCalledTimes(MAX_BACKFILLS_PER_RUN)
    expect(r.results.filter((x) => x.disposition === 'capped').length).toBe(60 - MAX_BACKFILLS_PER_RUN)
  })

  it('can be scoped to a single slug, so one known-broken company can be repaired alone', async () => {
    const { runZerodbKeyBackfillSweep, storeCompanyZerodbKey } = await load({
      apps: [
        { slug: 'agentive', zerodbProjectId: 'proj-agentive' },
        { slug: 'other', zerodbProjectId: 'proj-other' },
      ],
      mint: { 'proj-agentive': 'sk_a', 'proj-other': 'sk_b' },
    })

    const r = await runZerodbKeyBackfillSweep({ dryRun: false, onlySlugs: ['agentive'] })

    expect(r.checked).toBe(1)
    expect(r.backfilled).toBe(1)
    expect(storeCompanyZerodbKey).toHaveBeenCalledTimes(1)
    expect(storeCompanyZerodbKey).toHaveBeenCalledWith('proj-agentive', 'sk_a', expect.anything())
  })
})
