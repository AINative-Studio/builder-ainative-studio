/**
 * One-shot ZeroDB data-plane key backfill sweep (#1013).
 *
 * THE BUG THIS REPAIRS
 * `/api/db/{table}` — the proxy every generated company app uses for live CRUD
 * (waitlist signups, visitor tracking, any app-generated record) — resolves a
 * per-company, project-scoped ZeroDB key from `builder_company_zerodb_keys`
 * (#806, see lib/build/company-zerodb-credentials.ts) and FAILS CLOSED with a
 * 502 KEY_UNAVAILABLE when there is no stored key. Failing closed is correct:
 * the alternative is Builder's shared service key against someone else's
 * project, which ZeroDB rejects with a 403 API_KEY_PROJECT_MISMATCH anyway, and
 * which is exactly the cross-tenant mis-scoping #806 fixed.
 *
 * But the consequence for a company with no stored key is that every real
 * `/api/db` write is silently lost — the generated app's own codegen pattern
 * wraps these calls in `.catch(() => {})` and then shows a confident
 * "You're on the list," so a founder's real lead vanishes with no visible
 * error anywhere. Confirmed live for `agentive` (#1013).
 *
 * WHY A ONE-SHOT SWEEP AND NOT A CRON
 * #806 (merged 2026-09-22) fixed the forward-going path: provision now persists
 * the key it mints and surfaces `zerodbKeyStored: false` instead of swallowing a
 * failed write. A registry-wide audit found ~17 of 31 historically-provisioned
 * projects missing a key row — and every single affected row PREDATES #806.
 * There is no ongoing leak to guard against, so this is a reviewed repair script
 * for existing broken data, not a scheduled job. (If a post-#806 company ever
 * turns up here, that is a real new bug in the provision path and the sweep's
 * own output is the place it will show up.)
 *
 * HOW A MISSING KEY IS REPAIRED
 * The ORIGINAL key is unrecoverable — it was returned once by
 * `provisionInstantDb` at project-creation time and discarded. The project
 * itself still exists and still holds the founder's real data, so
 * re-provisioning (minting a brand-new project) would silently ORPHAN that
 * data. The repair is therefore to mint a FRESH key scoped to the EXISTING
 * project id, via `mintProjectScopedKey` (see its doc comment for the core
 * endpoint and the identity reasoning — Builder's own service identity, never a
 * borrowed founder token, per CODY.md Rule 5).
 *
 * SAFETY
 *  - DRY RUN BY DEFAULT. A real run mints real credentials against real
 *    customer projects. `dryRun: false` is required to write anything.
 *  - IDEMPOTENT. `hasCompanyZerodbKey` is checked per company immediately
 *    before acting, so a re-run skips everything it already fixed and never
 *    mints a second key for the same project.
 *  - FAILS CLOSED on an unverifiable has-key read. "I could not tell whether a
 *    key exists" must never become "mint a new one" — ZeroDB's read path is
 *    documented-flaky (see the showcase read-path incident), and minting over a
 *    key that already works would churn credentials for no reason.
 *  - NEVER FABRICATES SUCCESS. A failed mint and a failed store are each
 *    counted as failures with the real reason attached; a company whose
 *    underlying project is genuinely gone is reported as a terminal
 *    `mint_failed`, which is honest, not a script bug.
 *  - CAPPED per run, so a filter bug cannot mint keys across the whole registry.
 *  - A FAILED REGISTRY READ IS NOT "ZERO COMPANIES" (core#7395) — it is
 *    reported as `registryOk: false` and the sweep does nothing.
 */

import { listAllAppsWithStatus } from '@/lib/build/app-registry'
import {
  hasCompanyZerodbKey,
  storeCompanyZerodbKey,
  mintProjectScopedKey,
} from '@/lib/build/company-zerodb-credentials'

/**
 * Hard cap on real key mints per run. The measured backlog is ~17 companies, so
 * this is headroom rather than a limiter; a legitimately larger backlog is
 * drained by running the sweep again (it is idempotent). Each mint creates a
 * real credential in core against a real customer project, so an unbounded run
 * is not an acceptable failure mode for a filter bug.
 */
export const MAX_BACKFILLS_PER_RUN = 50

export type BackfillDisposition =
  /** Never provisioned — no zerodbProjectId, so there is nothing to key. */
  | 'not_provisioned'
  /** A key row already exists — skipped, nothing minted or written. */
  | 'already_stored'
  /** Missing a key, and a real run WOULD repair it (dry-run only). */
  | 'would_backfill'
  /** Missing a key; a fresh project-scoped key was minted AND stored. */
  | 'backfilled'
  /** Missing a key, but minting one failed (e.g. the project is gone). */
  | 'mint_failed'
  /** A key was minted but the encrypted store write failed — still broken. */
  | 'store_failed'
  /** Could not determine whether a key exists; skipped rather than guessed. */
  | 'unverifiable'
  /** Would have been repaired, but the per-run cap was already reached. */
  | 'capped'

export interface BackfillCompanyResult {
  slug: string
  projectId?: string
  disposition: BackfillDisposition
  /** The registry's recorded provisionedAt — the evidence this predates #806. */
  provisionedAt?: string
  /** Populated on any failure or fail-closed skip. Never a guess. */
  reason?: string
}

export interface BackfillSweepResult {
  /** Whether the sweep itself ran to completion (per-company failures do not clear this). */
  ok: boolean
  dryRun: boolean
  /** False when the registry read failed — results are then meaningless, NOT empty-but-fine. */
  registryOk: boolean
  /** Live, provisioned companies actually inspected. */
  checked: number
  /** Of those, how many had no stored key. */
  missing: number
  /** Real repairs completed (always 0 in a dry run). */
  backfilled: number
  /** Companies that needed a repair and did not get one, for any reason. */
  failed: number
  byDisposition: Record<string, number>
  results: BackfillCompanyResult[]
}

/** A soft-deleted company (#57) is gone — never mint credentials for it. */
function isDeleted(app: { lifecycleStatus?: string }): boolean {
  return (app.lifecycleStatus || 'active') === 'deleted'
}

/**
 * Run the backfill sweep.
 *
 * `dryRun` defaults to TRUE — an accidental call, a probe, or an import-time
 * mistake must never mint real credentials (same posture as
 * runLoopBackfillSweep / runWinbackSweep).
 *
 * `onlySlugs` scopes the run to named companies, so a single known-broken
 * company (e.g. `agentive`) can be repaired and verified on its own before a
 * wider run.
 */
export async function runZerodbKeyBackfillSweep(
  opts: { dryRun?: boolean; onlySlugs?: string[] } = {},
): Promise<BackfillSweepResult> {
  const dryRun = opts.dryRun !== false
  const only = (opts.onlySlugs || []).map((s) => (s || '').trim()).filter(Boolean)
  const onlySet = only.length ? new Set(only) : null

  const empty = (registryOk: boolean): BackfillSweepResult => ({
    ok: true,
    dryRun,
    registryOk,
    checked: 0,
    missing: 0,
    backfilled: 0,
    failed: 0,
    byDisposition: {},
    results: [],
  })

  const { apps, ok: registryOk } = await listAllAppsWithStatus()
  if (!registryOk) {
    // A failed read is NOT "no companies need fixing" (core#7395). Report it and
    // do nothing, rather than logging a clean "0 missing" success.
    console.error(
      '[zerodb-key-backfill] ABORTED — company registry read failed. ' +
        'An empty result here is NOT "every company has a key"; re-run once the read recovers.',
    )
    return empty(false)
  }

  const results: BackfillCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let checked = 0
  let missing = 0
  let backfilled = 0
  let failed = 0

  const record = (r: BackfillCompanyResult) => {
    results.push(r)
    byDisposition[r.disposition] = (byDisposition[r.disposition] || 0) + 1
  }

  for (const app of apps) {
    const slug = app.slug
    if (onlySet && !onlySet.has(slug)) continue
    if (isDeleted(app)) continue

    const projectId = (app.zerodbProjectId || '').trim()
    // Never provisioned → there is no project to scope a key to. Not a failure.
    if (!projectId) {
      record({ slug, disposition: 'not_provisioned' })
      continue
    }

    checked++

    // Idempotency + fail-closed gate, read immediately before acting so a
    // re-run (or a concurrent provision) can never cause a duplicate mint.
    let stored: boolean
    try {
      stored = await hasCompanyZerodbKey(projectId)
    } catch (e: any) {
      failed++
      record({
        slug,
        projectId,
        provisionedAt: app.provisionedAt,
        disposition: 'unverifiable',
        reason: `has_key_check_failed: ${String(e?.message || e).slice(0, 120)}`,
      })
      continue
    }

    if (stored) {
      record({ slug, projectId, provisionedAt: app.provisionedAt, disposition: 'already_stored' })
      continue
    }

    missing++

    if (dryRun) {
      record({ slug, projectId, provisionedAt: app.provisionedAt, disposition: 'would_backfill' })
      continue
    }

    if (backfilled >= MAX_BACKFILLS_PER_RUN) {
      record({
        slug,
        projectId,
        provisionedAt: app.provisionedAt,
        disposition: 'capped',
        reason: `per-run cap of ${MAX_BACKFILLS_PER_RUN} reached — re-run to continue`,
      })
      continue
    }

    // Mint a FRESH key against the EXISTING project (never re-provision — that
    // would create a new project and orphan the founder's real data).
    const minted = await mintProjectScopedKey(projectId, { slug }).catch((e: any) => ({
      ok: false as const,
      reason: String(e?.message || e).slice(0, 160),
    }))
    if (!minted.ok || !minted.apiKey) {
      failed++
      record({
        slug,
        projectId,
        provisionedAt: app.provisionedAt,
        disposition: 'mint_failed',
        reason: minted.reason || 'mint_failed',
      })
      continue
    }

    // keyKind is 'permanent' regardless of what the registry row says: this is a
    // newly minted service-identity key against an existing project, not the
    // original 72h tmp_ trial key, so recording it as 'tmp' would misdescribe it
    // (and imply an expiry that does not apply). The registry's own keyKind —
    // which drives the separate trial/claim UI — is deliberately left untouched.
    const wrote = await storeCompanyZerodbKey(projectId, minted.apiKey, {
      slug,
      keyKind: 'permanent',
    }).catch(() => false)

    if (!wrote) {
      // The company is STILL broken — a minted-but-unstored key fixes nothing.
      failed++
      record({
        slug,
        projectId,
        provisionedAt: app.provisionedAt,
        disposition: 'store_failed',
        reason: 'key minted but the encrypted store write failed — company still fails closed',
      })
      continue
    }

    backfilled++
    record({ slug, projectId, provisionedAt: app.provisionedAt, disposition: 'backfilled' })
  }

  return { ok: true, dryRun, registryOk: true, checked, missing, backfilled, failed, byDisposition, results }
}
