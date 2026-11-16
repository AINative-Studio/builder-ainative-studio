/**
 * One-shot enrollment-ownerKey backfill sweep (#2114) — the retroactive half
 * of #2111/#2113.
 *
 * THE GAP THIS CLOSES
 * #2113 added `syncEnrollmentOwnerKey()` and wired it into the three places
 * that learn a company's REAL owner after its first enrollment (a later
 * `register-app` regen, `subscription/verify` at checkout, and `provision`).
 * That corrects a stale/empty `builder_loop_enrollments.ownerKey` the next
 * time one of those three routes fires for a company — but does nothing for
 * a company that is already stuck today and has no reason to hit any of
 * those routes again (e.g. a founder who claimed and paid for their company
 * months ago and has not re-registered, checked out, or re-provisioned
 * since). `wrench` and `tidemark` (see #2089/#2111/#2114) both plausibly fit
 * this shape: previously-active, fully-provisioned companies whose nightly
 * loop went silent, not companies mid-onboarding.
 *
 * WHAT THIS SWEEP DOES
 * For every live (non-deleted) registered company with a resolvable
 * `ownerEmail` on its `builder_app_registry` row, call the already-reviewed
 * `syncEnrollmentOwnerKey(slug, ownerEmail)` — no new write logic here, this
 * is pure plumbing over #2113's function, same shape as
 * `lib/build/loop-backfill.ts` (#841) and `lib/build/metadata-backfill.ts`
 * (#2092).
 *
 * SAFETY
 *  - Dry-run by default, same CLI convention as every other backfill script
 *    in this repo (`parseBackfillArgs`): `--apply` is required to write.
 *  - `syncEnrollmentOwnerKey()` is itself a safe no-op when a company isn't
 *    enrolled yet or its `ownerKey` already matches — this sweep adds no new
 *    risk beyond calling that reviewed function once per eligible company.
 *  - Fails CLOSED. A registry read failure aborts with `registryOk: false`
 *    rather than reporting "0 companies checked" as if the sweep ran clean.
 *  - A company with no resolvable `ownerEmail` (never claimed) is skipped,
 *    not guessed at — `syncEnrollmentOwnerKey` requires a real key to act on.
 */

import { listAllAppsWithStatus, type AppEntry } from '@/lib/build/app-registry'
import { syncEnrollmentOwnerKey } from '@/lib/build/loop-enrollment'

function isDeleted(app: { lifecycleStatus?: string }): boolean {
  return (app.lifecycleStatus || 'active') === 'deleted'
}

export type OwnerKeyBackfillDisposition =
  | 'no_owner_email'
  | 'would_sync'
  | 'synced'
  | 'sync_failed'

export interface OwnerKeyBackfillCompanyResult {
  slug: string
  disposition: OwnerKeyBackfillDisposition
  ownerEmail?: string
}

export interface OwnerKeyBackfillSweepResult {
  ok: true
  dryRun: boolean
  /** False when the registry read itself failed — an empty result is then
   *  NOT "every company is already synced". Callers must not report success
   *  on this (core#7395-style pitfall; see metadata-backfill.ts/loop-backfill.ts). */
  registryOk: boolean
  /** Companies with a resolvable ownerEmail — the real candidate set. */
  checked: number
  synced: number
  failed: number
  byDisposition: Record<string, number>
  results: OwnerKeyBackfillCompanyResult[]
}

export async function runOwnerKeyBackfillSweep(
  opts: { dryRun?: boolean; onlySlugs?: string[] } = {},
): Promise<OwnerKeyBackfillSweepResult> {
  const dryRun = opts.dryRun !== false
  const only = (opts.onlySlugs || []).map((s) => (s || '').trim()).filter(Boolean)
  const onlySet = only.length ? new Set(only) : null

  const empty = (registryOk: boolean): OwnerKeyBackfillSweepResult => ({
    ok: true,
    dryRun,
    registryOk,
    checked: 0,
    synced: 0,
    failed: 0,
    byDisposition: {},
    results: [],
  })

  const { apps, ok: registryOk } = await listAllAppsWithStatus()
  if (!registryOk) {
    console.error(
      '[loop-enrollment-backfill] ABORTED — company registry read failed. ' +
        'An empty result here is NOT "every company already synced"; re-run once the read recovers.',
    )
    return empty(false)
  }

  const results: OwnerKeyBackfillCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let checked = 0
  let synced = 0
  let failed = 0

  const record = (r: OwnerKeyBackfillCompanyResult) => {
    results.push(r)
    byDisposition[r.disposition] = (byDisposition[r.disposition] || 0) + 1
  }

  for (const app of apps as AppEntry[]) {
    const slug = app.slug
    if (onlySet && !onlySet.has(slug)) continue
    if (isDeleted(app)) continue

    const ownerEmail = (app.ownerEmail || '').trim().toLowerCase()
    if (!ownerEmail) {
      record({ slug, disposition: 'no_owner_email' })
      continue
    }

    checked++

    if (dryRun) {
      record({ slug, disposition: 'would_sync', ownerEmail })
      continue
    }

    const ok = await syncEnrollmentOwnerKey(slug, ownerEmail).catch(() => false)
    if (ok) {
      synced++
      record({ slug, disposition: 'synced', ownerEmail })
    } else {
      failed++
      record({ slug, disposition: 'sync_failed', ownerEmail })
    }
  }

  return { ok: true, dryRun, registryOk: true, checked, synced, failed, byDisposition, results }
}
